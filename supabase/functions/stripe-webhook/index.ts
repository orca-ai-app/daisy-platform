// supabase/functions/stripe-webhook/index.ts
//
// Stripe Connect webhook — handles events on connected accounts for all 60+
// franchisee Stripe accounts routed through the single platform endpoint.
//
// Deploy flag: --no-verify-jwt  (Stripe signature replaces JWT auth)
//
// Reference:
//   DECISIONS.md (M2 section) — booking row timing, spot decrement, overbook flag
//   docs/stripe-connect-setup.md — Account Links connect model
//   supabase/migrations/003_customer_booking_tables.sql — da_bookings, da_customers
//   supabase/migrations/005_billing_tables.sql — da_email_sequences
//   supabase/migrations/008_helper_functions.sql — decrement_spots, next_booking_reference
//   supabase/migrations/019_payment_link_storage.sql — da_course_instances columns
//   supabase/migrations/020_email_sequence_template_keys.sql — allowed template_key set
//   supabase/migrations/021_course_instance_private_client.sql — private_client_id on instance
//
// Events handled:
//   checkout.session.completed       — create booking, decrement spots, queue email sequences
//   account.updated                  — sync da_franchisees.stripe_connected from charges_enabled
//   account.application.deauthorized — franchisee revoked OAuth access; clear the link
//
// Error policy:
//   - Missing STRIPE_WEBHOOK_SECRET → 500 (fail closed; live test gated on secret being set)
//   - Invalid Stripe signature → 400
//   - Internal processing failure → 200 (avoids Stripe retry → double-booking) + console.error
//
// Money: always integer pence. Never floats.

// deno-lint-ignore-file no-explicit-any

import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// No CORS headers — this endpoint is called by Stripe's servers, not a browser.
// We do need to respond quickly to avoid Stripe's 30 s timeout.

// Allowed template_keys per migration 020 CHECK constraint.
// ONLY insert keys from this set. Any key not listed here violates the constraint.
const ALLOWED_TEMPLATE_KEYS = new Set([
  'new_booking_notification',
  'booking_confirmation',
  'thank_you',
  'refresher_6w',
  'refresher_3m',
  'refresher_6m',
  'refresher_9m',
  'refresher_12m',
  'quiz_prompt',
  'fee_invoice',
  'fee_chase_1',
  'fee_chase_2',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CourseInstanceRow {
  id: string;
  franchisee_id: string;
  event_date: string; // DATE as ISO string 'YYYY-MM-DD'
  private_client_id: string | null;
}

interface TicketTypeRow {
  id: string;
  seats_consumed: number;
  price_pence: number;
}

interface FranchiseeRow {
  id: string;
  number: string; // VARCHAR(4), e.g. '0001'
}

interface CustomerRow {
  id: string;
}

// ---------------------------------------------------------------------------
// Email sequence helpers
// ---------------------------------------------------------------------------

// Compute the scheduled_for timestamp (UTC) by adding days to a base date.
function daysFromDate(baseDate: Date, days: number): Date {
  const d = new Date(baseDate.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// Build da_email_sequences rows for a confirmed booking.
// All keys MUST be in ALLOWED_TEMPLATE_KEYS — the CHECK constraint on
// da_email_sequences.template_key will reject any that aren't.
//
// Schedule (derived from migration 020 key names and M2 handover §email sequences):
//   now (sequence_day 0):
//     - new_booking_notification → franchisee (sent to franchisee via customer record
//       but keyed to the booking; the send-emails cron uses template_key to route)
//     - booking_confirmation → customer (immediate)
//   event_date + 1 day (sequence_day 1):
//     - thank_you → customer (post-course follow-up)
//   event_date + 42 days (sequence_day 42 = 6 weeks):
//     - refresher_6w → customer
//   event_date + 90 days (sequence_day 90 = ~3 months):
//     - refresher_3m → customer
//   event_date + 180 days (sequence_day 180 = ~6 months):
//     - refresher_6m → customer
//   event_date + 270 days (sequence_day 270 = ~9 months):
//     - refresher_9m → customer
//   event_date + 365 days (sequence_day 365 = 12 months):
//     - refresher_12m → customer
//
// NOTE: 'quiz_prompt' is in the allowed set but has no PRD §4.14 offset defined
// in the available docs. It is OMITTED here and listed in the final report for a
// follow-up decision. 'fee_invoice' / 'fee_chase_1' / 'fee_chase_2' are billing
// sequences, not booking sequences — not queued here.
function buildEmailSequenceRows(
  customerId: string,
  bookingId: string,
  now: Date,
  eventDate: Date,
): Array<{
  customer_id: string;
  booking_id: string;
  template_key: string;
  sequence_day: number;
  scheduled_for: string;
  status: 'pending';
}> {
  const rows: Array<{
    customer_id: string;
    booking_id: string;
    template_key: string;
    sequence_day: number;
    scheduled_for: string;
    status: 'pending';
  }> = [];

  function push(templateKey: string, scheduledFor: Date, sequenceDay: number): void {
    if (!ALLOWED_TEMPLATE_KEYS.has(templateKey)) {
      // Belt-and-braces guard — should never fire given the constant above.
      console.error(`stripe-webhook: refusing to queue disallowed template_key="${templateKey}"`);
      return;
    }
    rows.push({
      customer_id: customerId,
      booking_id: bookingId,
      template_key: templateKey,
      sequence_day: sequenceDay,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
    });
  }

  // Immediate (day 0 relative to booking time)
  push('new_booking_notification', now, 0);
  push('booking_confirmation', now, 0);

  // Post-event (day 1 after the course date)
  push('thank_you', daysFromDate(eventDate, 1), 1);

  // Refresher series (offsets from event_date)
  push('refresher_6w', daysFromDate(eventDate, 42), 42);
  push('refresher_3m', daysFromDate(eventDate, 90), 90);
  push('refresher_6m', daysFromDate(eventDate, 180), 180);
  push('refresher_9m', daysFromDate(eventDate, 270), 270);
  push('refresher_12m', daysFromDate(eventDate, 365), 365);

  // 'quiz_prompt' — offset not defined in available PRD docs; omitted.
  // Requires a follow-up migration / decision before queuing.

  return rows;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // -------------------------------------------------------------------------
  // Environment — fail closed when webhook secret is absent
  // -------------------------------------------------------------------------
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  if (!webhookSecret) {
    console.error(
      'stripe-webhook: STRIPE_WEBHOOK_SECRET is not set. ' +
        'Register the webhook endpoint in Stripe and add the signing secret to Supabase secrets.',
    );
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (!stripeSecretKey) {
    console.error('stripe-webhook: STRIPE_SECRET_KEY is not set.');
    return new Response('Stripe key not configured', { status: 500 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('stripe-webhook: Supabase env vars not set.');
    return new Response('Server misconfigured', { status: 500 });
  }

  // -------------------------------------------------------------------------
  // Read RAW body (required for Stripe signature verification — must NOT parse
  // as JSON first; constructEventAsync hashes the raw bytes).
  // -------------------------------------------------------------------------
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    console.error('stripe-webhook: failed to read request body', err);
    return new Response('Could not read body', { status: 400 });
  }

  const sigHeader = req.headers.get('stripe-signature') ?? '';
  if (!sigHeader) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // -------------------------------------------------------------------------
  // Verify Stripe signature — use constructEventAsync (sync throws in Deno)
  // -------------------------------------------------------------------------
  const stripe = new Stripe(stripeSecretKey, {
    // @ts-ignore — httpClient not in the type stubs for this import path
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sigHeader, webhookSecret);
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err);
    return new Response('Invalid signature', { status: 400 });
  }

  // -------------------------------------------------------------------------
  // Service-role Supabase client (bypasses RLS — all writes happen here)
  // -------------------------------------------------------------------------
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // -------------------------------------------------------------------------
  // Dispatch on event type
  // -------------------------------------------------------------------------
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(admin, event);
        break;

      case 'account.updated':
        await handleAccountUpdated(admin, event);
        break;

      case 'account.application.deauthorized':
        await handleAccountDeauthorized(admin, event);
        break;

      default:
        // Stripe sends many event types; silently ack anything we don't handle.
        console.log(`stripe-webhook: ignoring event type="${event.type}" id="${event.id}"`);
        break;
    }
  } catch (err) {
    // Internal error — log loudly but return 200 to prevent Stripe retrying
    // (a retry on checkout.session.completed risks creating a duplicate booking).
    console.error(
      `stripe-webhook: unhandled error processing event="${event.type}" id="${event.id}"`,
      err,
    );

    // Best-effort activity row so the failure is visible in the HQ audit log.
    await admin
      .from('da_activities')
      .insert({
        // entity_id is NOT NULL (UUID) per migration 006. There is no natural
        // entity for a generic webhook failure, so mint a synthetic UUID — same
        // pattern as geocode-postcode's system events. The real event id lives
        // in metadata.event_id.
        actor_type: 'system',
        actor_id: null,
        entity_type: 'stripe_event',
        entity_id: crypto.randomUUID(),
        action: 'webhook_processing_error',
        metadata: {
          event_id: event.id,
          event_type: event.type,
          error: String(err),
        },
        description: `Stripe webhook processing error for event ${event.type} (${event.id})`,
      })
      .then((r: { error: unknown }) => {
        if (r.error) console.error('stripe-webhook: could not write error activity row', r.error);
      });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(
  admin: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  // -------------------------------------------------------------------------
  // Step 1 — Validate metadata from the Payment Link
  // Metadata was stamped by 8B when the Payment Link was created:
  // { course_instance_id, ticket_type_id, quantity, franchisee_id }
  // -------------------------------------------------------------------------
  const meta = session.metadata ?? {};
  const courseInstanceId = meta.course_instance_id ?? null;
  const ticketTypeId = meta.ticket_type_id ?? null;
  const quantityRaw = meta.quantity ?? null;
  const franchiseeId = meta.franchisee_id ?? null;

  if (!courseInstanceId) {
    // Not a Daisy Payment Link — acknowledge silently.
    console.log(
      `stripe-webhook: checkout.session.completed missing course_instance_id — not a Daisy link. session="${session.id}"`,
    );
    return;
  }

  if (!ticketTypeId || !quantityRaw || !franchiseeId) {
    // Daisy link but incomplete metadata — log for investigation, still ack.
    console.error(
      'stripe-webhook: checkout.session.completed has course_instance_id but is missing ' +
        `ticket_type_id / quantity / franchisee_id. session="${session.id}" meta=`,
      meta,
    );
    return;
  }

  const quantity = parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    console.error(
      `stripe-webhook: invalid quantity="${quantityRaw}" in metadata. session="${session.id}"`,
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Step 2 — Idempotency: skip if booking already exists for this session
  // Stripe retries on network failures; the checkout session ID is our
  // idempotency key.
  // -------------------------------------------------------------------------
  const existing = await admin
    .from('da_bookings')
    .select('id')
    .eq('stripe_checkout_session_id', session.id)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`Idempotency check failed: ${existing.error.message}`);
  }
  if (existing.data) {
    console.log(
      `stripe-webhook: booking already exists for session="${session.id}" — skipping (idempotent replay)`,
    );
    return;
  }

  // -------------------------------------------------------------------------
  // Step 3 — Upsert da_customers by email
  // customer_details is guaranteed present on completed checkout sessions.
  // -------------------------------------------------------------------------
  const customerDetails = session.customer_details;
  if (!customerDetails?.email) {
    throw new Error(
      `checkout.session.completed has no customer_details.email. session="${session.id}"`,
    );
  }

  // Parse name — Stripe provides full_name; split on first space.
  const fullName = customerDetails.name ?? '';
  const spaceIdx = fullName.indexOf(' ');
  const firstName =
    spaceIdx > -1 ? fullName.slice(0, spaceIdx).trim() : fullName.trim() || 'Unknown';
  const lastName = spaceIdx > -1 ? fullName.slice(spaceIdx + 1).trim() : '';

  const customerEmail = customerDetails.email.trim().toLowerCase();
  const customerPhone = customerDetails.phone ?? null;

  const customerUpsert = await admin
    .from('da_customers')
    .upsert(
      {
        email: customerEmail,
        first_name: firstName,
        last_name: lastName || 'Unknown',
        phone: customerPhone,
        // postcode: not captured by Stripe Payment Link; left null
      },
      {
        onConflict: 'email',
        // Update name/phone in case they've changed since last booking.
        ignoreDuplicates: false,
      },
    )
    .select('id')
    .single();

  if (customerUpsert.error || !customerUpsert.data) {
    throw new Error(`Customer upsert failed: ${customerUpsert.error?.message}`);
  }

  const customerId = (customerUpsert.data as CustomerRow).id;

  // -------------------------------------------------------------------------
  // Step 4 — Load course instance + ticket type
  // -------------------------------------------------------------------------
  const instanceResult = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, event_date, private_client_id')
    .eq('id', courseInstanceId)
    .single();

  if (instanceResult.error || !instanceResult.data) {
    throw new Error(
      `Course instance not found: id="${courseInstanceId}" error="${instanceResult.error?.message}"`,
    );
  }

  const instance = instanceResult.data as CourseInstanceRow;

  const ticketTypeResult = await admin
    .from('da_ticket_types')
    .select('id, seats_consumed, price_pence')
    .eq('id', ticketTypeId)
    .eq('course_instance_id', courseInstanceId)
    .single();

  if (ticketTypeResult.error || !ticketTypeResult.data) {
    throw new Error(
      `Ticket type not found: id="${ticketTypeId}" instance="${courseInstanceId}" error="${ticketTypeResult.error?.message}"`,
    );
  }

  const ticketType = ticketTypeResult.data as TicketTypeRow;
  const seatsToDecrement = ticketType.seats_consumed * quantity;

  // -------------------------------------------------------------------------
  // Step 4b — Load franchisee (need .number for booking reference)
  // -------------------------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, number')
    .eq('id', franchiseeId)
    .single();

  if (franchiseeResult.error || !franchiseeResult.data) {
    throw new Error(
      `Franchisee not found: id="${franchiseeId}" error="${franchiseeResult.error?.message}"`,
    );
  }

  const franchisee = franchiseeResult.data as FranchiseeRow;

  // -------------------------------------------------------------------------
  // Step 5 — Atomic spot decrement
  // decrement_spots returns TRUE when spots were available and decremented,
  // FALSE when the instance had fewer spots than requested (overbook).
  // -------------------------------------------------------------------------
  const decrementResult = await admin.rpc('decrement_spots', {
    instance_id: courseInstanceId,
    seats: seatsToDecrement,
  });

  if (decrementResult.error) {
    throw new Error(`decrement_spots RPC failed: ${decrementResult.error.message}`);
  }

  const spotsDecrementedOk = decrementResult.data as boolean;
  const isOverbook = !spotsDecrementedOk;

  const paymentStatus: 'paid' | 'manual' = isOverbook ? 'manual' : 'paid';

  if (isOverbook) {
    console.error(
      `stripe-webhook: OVERBOOK — not enough spots on instance="${courseInstanceId}" ` +
        `session="${session.id}" seats_requested=${seatsToDecrement}. ` +
        'Booking will be created with payment_status="manual" for HQ review.',
    );
  }

  // -------------------------------------------------------------------------
  // Step 6 — Generate booking reference
  // -------------------------------------------------------------------------
  const bookingRefResult = await admin.rpc('next_booking_reference', {
    franchisee_number: franchisee.number,
  });

  if (bookingRefResult.error) {
    throw new Error(`next_booking_reference RPC failed: ${bookingRefResult.error.message}`);
  }

  const bookingReference = bookingRefResult.data as string;

  // -------------------------------------------------------------------------
  // Step 7 — Insert da_bookings
  //
  // total_price_pence: use session.amount_total (integer pence from Stripe).
  // If Stripe returns null (free session), fall back to ticket price × quantity.
  // -------------------------------------------------------------------------
  const totalPricePence =
    typeof session.amount_total === 'number'
      ? session.amount_total
      : ticketType.price_pence * quantity;

  const stripePaymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null;

  const bookingInsert = await admin
    .from('da_bookings')
    .insert({
      booking_reference: bookingReference,
      course_instance_id: courseInstanceId,
      franchisee_id: franchiseeId,
      customer_id: customerId,
      private_client_id: instance.private_client_id ?? null,
      ticket_type_id: ticketTypeId,
      quantity,
      total_price_pence: totalPricePence,
      payment_status: paymentStatus,
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_checkout_session_id: session.id,
      booking_status: 'confirmed',
    })
    .select('id')
    .single();

  if (bookingInsert.error || !bookingInsert.data) {
    throw new Error(`da_bookings insert failed: ${bookingInsert.error?.message}`);
  }

  const bookingId = (bookingInsert.data as { id: string }).id;

  // -------------------------------------------------------------------------
  // Step 8 — Queue da_email_sequences
  // -------------------------------------------------------------------------
  const now = new Date();
  // Parse event_date as UTC midnight so refresher offsets don't drift by timezone.
  const eventDate = new Date(`${instance.event_date}T00:00:00Z`);

  const emailRows = buildEmailSequenceRows(customerId, bookingId, now, eventDate);

  if (emailRows.length > 0) {
    const emailInsert = await admin.from('da_email_sequences').insert(emailRows);
    if (emailInsert.error) {
      // Email queue failure must NOT roll back the booking — money has moved.
      // Log for manual recovery; the send-emails cron can be re-seeded if needed.
      console.error(
        `stripe-webhook: da_email_sequences insert failed for booking="${bookingId}":`,
        emailInsert.error,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Step 9 — Activity row: booking_created (+ overbooking flag if applicable)
  // -------------------------------------------------------------------------
  const activityMeta: Record<string, unknown> = {
    booking_reference: bookingReference,
    course_instance_id: courseInstanceId,
    franchisee_id: franchiseeId,
    customer_email: customerEmail,
    ticket_type_id: ticketTypeId,
    quantity,
    total_price_pence: totalPricePence,
    payment_status: paymentStatus,
    stripe_checkout_session_id: session.id,
  };

  if (isOverbook) {
    activityMeta.overbooking = true;
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'booking_created',
      metadata: activityMeta,
      description: `Booking ${bookingReference} created via Stripe webhook${isOverbook ? ' — OVERBOOK: requires manual review' : ''}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('stripe-webhook: booking_created activity insert failed', r.error);
    });

  console.log(
    `stripe-webhook: booking created ref="${bookingReference}" id="${bookingId}" ` +
      `customer="${customerEmail}" session="${session.id}" overbook=${isOverbook}`,
  );
}

// ---------------------------------------------------------------------------
// account.updated — sync stripe_connected from charges_enabled
// ---------------------------------------------------------------------------

async function handleAccountUpdated(
  admin: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  // event.account is the connected account ID (set by Stripe for Connect events).
  const stripeAccountId = event.account ?? null;
  if (!stripeAccountId) {
    console.error('stripe-webhook: account.updated event has no event.account id');
    return;
  }

  const account = event.data.object as Stripe.Account;
  const chargesEnabled = account.charges_enabled ?? false;

  const updateResult = await admin
    .from('da_franchisees')
    .update({
      stripe_connected: chargesEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_account_id', stripeAccountId);

  if (updateResult.error) {
    throw new Error(
      `da_franchisees stripe_connected sync failed: account="${stripeAccountId}" ` +
        `error="${updateResult.error.message}"`,
    );
  }

  // rowCount is not exposed by the Supabase JS client without .select(); treat
  // a no-match as a warning (Stripe may fire account.updated before our
  // create-franchisee flow stamps the stripe_account_id).
  console.log(
    `stripe-webhook: account.updated synced stripe_connected=${chargesEnabled} for account="${stripeAccountId}"`,
  );
}

// ---------------------------------------------------------------------------
// account.application.deauthorized — franchisee revoked our OAuth access from
// their own Stripe dashboard. Clear the link so the portal reflects it.
// ---------------------------------------------------------------------------

async function handleAccountDeauthorized(
  admin: ReturnType<typeof createClient>,
  event: Stripe.Event,
): Promise<void> {
  // For connected-account events, event.account is the account that deauthorized.
  const stripeAccountId = event.account ?? null;
  if (!stripeAccountId) {
    console.error('stripe-webhook: account.application.deauthorized has no event.account id');
    return;
  }

  const updateResult = await admin
    .from('da_franchisees')
    .update({
      stripe_account_id: null,
      stripe_connected: false,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_account_id', stripeAccountId);

  if (updateResult.error) {
    throw new Error(
      `da_franchisees deauthorize clear failed: account="${stripeAccountId}" ` +
        `error="${updateResult.error.message}"`,
    );
  }

  console.log(
    `stripe-webhook: account.application.deauthorized cleared link for account="${stripeAccountId}"`,
  );
}

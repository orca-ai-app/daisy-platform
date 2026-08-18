// supabase/functions/create-checkout-session/index.ts
//
// PUBLIC (no auth) — creates a Stripe Checkout Session for a public widget
// booking OR a private /book/:token booking. PRD §5.3. Serves BOTH surfaces.
// Since migration 044 it ALSO sells undated ITEMS (books, kits, e-learning).
//
// COURSE path — POST {
//   course_instance_id?: string,   // public widget passes this
//   booking_token?: string,        // /book/:token page passes this instead
//   ticket_type_id: string,
//   quantity: number,
//   customer: { first_name, last_name, email, phone, postcode },
//   discount_code?: string,
//   origin?: string                // caller's site origin, for success/cancel URLs
// }
// -> 201 { checkout_url, session_id, booking_reference }
//
// ITEM path — POST {
//   franchisee_product_id: string, // da_franchisee_products.id from get-public-items
//   quantity?: number,             // default 1, max 20
//   customer: { first_name, last_name, email, phone, postcode },
//   origin?: string
// }
//
// EVERY customer field above is required (round 2, G3: phone and postcode were
// optional and franchisees could not chase a no-show without them).
// -> 201 { checkout_url, session_id }
//
// The two paths are MUTUALLY EXCLUSIVE — sending course fields alongside
// franchisee_product_id is a 400, not a guess. Items reserve nothing (no
// seats), create no booking, and take no discount code; the sale row is written
// by stripe-webhook on payment, keyed on the session id for idempotency.
//
// Flow: resolve course (by id or token) → verify scheduled + enough spaces →
// franchisee Stripe-connected → price the ticket → apply+store discount →
// upsert customer → resolve client (email dedup) → write a PENDING booking →
// create Stripe Checkout on the connected account → stamp the session id.
//
// Spots ARE reserved here (reserve_spots, migration 035) so two checkouts can
// never both pay for the last place; the webhook only confirms. Abandoned
// checkouts release their hold via the hourly sweep (35 min). uses_count is
// bumped at confirmation. If Stripe fails, booking + hold are rolled back.
//
// Platform fee removed pre-launch (2026-08): HQ bills franchisees monthly
// (MAX(base, 10%)), so the per-transaction application fee was an artefact.
// PLATFORM_FEE_PERCENT now defaults to 0 and a 0 fee is omitted entirely.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext';
import { logSystem, newRequestId } from '../_shared/log.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function reqStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

// Only build redirect URLs from a trusted origin (no open redirects).
function safeOrigin(origin: string | null): string {
  const fallback = Deno.env.get('BOOKING_BASE_URL') ?? 'https://booking.daisyfirstaid.com';
  if (!origin) return fallback;
  try {
    const u = new URL(origin);
    const ok =
      u.hostname.endsWith('daisyfirstaid.com') ||
      u.hostname.endsWith('netlify.app') ||
      u.hostname === 'localhost';
    return ok ? `${u.protocol}//${u.host}` : fallback;
  } catch {
    return fallback;
  }
}

function discountOff(type: 'percentage' | 'fixed', value: number, amountPence: number): number {
  if (amountPence <= 0) return 0;
  if (type === 'percentage') return Math.min(amountPence, Math.floor((amountPence * value) / 100));
  return Math.min(amountPence, value);
}

interface CustomerInput {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  phone?: unknown;
  postcode?: unknown;
}
interface RequestBody {
  course_instance_id?: unknown;
  booking_token?: unknown;
  ticket_type_id?: unknown;
  quantity?: unknown;
  customer?: CustomerInput;
  discount_code?: unknown;
  origin?: unknown;
  franchisee_product_id?: unknown;
}

// Shared by both paths. Round 2 (G3): phone and postcode are now COMPULSORY,
// not optional. Franchisees could not chase a no-show or work out which class a
// customer meant without them, so both surfaces mark the fields required and
// this is the server-side backstop.
interface ParsedCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  postcode: string;
}

function parseCustomer(c: CustomerInput): ParsedCustomer | string {
  const firstName = reqStr(c.first_name);
  const lastName = reqStr(c.last_name);
  const emailRaw = reqStr(c.email);
  const phone = reqStr(c.phone);
  const postcode = reqStr(c.postcode);
  if (!firstName || !lastName) return 'customer first_name and last_name are required';
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) return 'a valid customer email is required';
  if (!phone) return 'a contact phone number is required';
  if (!postcode) return 'a postcode is required';
  return {
    firstName,
    lastName,
    email: emailRaw.toLowerCase(),
    phone,
    postcode,
  };
}

const MAX_ITEM_QUANTITY = 20;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const feePercentRaw = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '0');
  const feePercent = Number.isFinite(feePercentRaw) ? feePercentRaw : 0;
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const courseInstanceId = reqStr(body.course_instance_id);
  const bookingToken = reqStr(body.booking_token);
  const ticketTypeId = reqStr(body.ticket_type_id);

  // --- ITEM path (migration 044) --------------------------------------------
  // Undated products — books, kits, e-learning. No course, no seats, no
  // booking row: stripe-webhook writes the da_product_sales row on payment.
  const franchiseeProductId = reqStr(body.franchisee_product_id);
  if (franchiseeProductId) {
    if (courseInstanceId || bookingToken || ticketTypeId) {
      return jsonResponse(
        { error: 'franchisee_product_id cannot be combined with a course booking' },
        400,
      );
    }
    return await createItemSession(admin, body, franchiseeProductId, stripeSecretKey);
  }

  if (!courseInstanceId && !bookingToken) {
    return jsonResponse({ error: 'course_instance_id or booking_token is required' }, 400);
  }
  if (!ticketTypeId) return jsonResponse({ error: 'ticket_type_id is required' }, 400);

  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return jsonResponse({ error: 'quantity must be a positive integer' }, 400);
  }

  const parsed = parseCustomer(body.customer ?? {});
  if (typeof parsed === 'string') return jsonResponse({ error: parsed }, 400);
  const { firstName, lastName, email, phone, postcode } = parsed;

  // --- Resolve course instance (by id or token) -----------------------------
  let q = admin
    .from('da_course_instances')
    .select(
      'id, franchisee_id, template_id, event_date, private_client_id, status, visibility, spots_remaining',
    );
  q = courseInstanceId ? q.eq('id', courseInstanceId) : q.eq('booking_token', bookingToken!);
  const instRes = await q.maybeSingle();
  if (instRes.error) {
    console.error('instance lookup failed', instRes.error);
    return jsonResponse({ error: 'Could not load the course' }, 500);
  }
  if (!instRes.data) return jsonResponse({ error: 'Course not found' }, 404);
  const instance = instRes.data as any;

  if (instance.status !== 'scheduled') {
    return jsonResponse({ error: 'This course is no longer open for booking' }, 409);
  }

  // --- Ticket type ----------------------------------------------------------
  const ttRes = await admin
    .from('da_ticket_types')
    .select('id, name, price_pence, seats_consumed')
    .eq('id', ticketTypeId)
    .eq('course_instance_id', instance.id)
    .maybeSingle();
  if (ttRes.error) {
    console.error('ticket lookup failed', ttRes.error);
    return jsonResponse({ error: 'Could not load the ticket type' }, 500);
  }
  if (!ttRes.data) return jsonResponse({ error: 'Ticket type not found for this course' }, 404);
  const ticket = ttRes.data as any;

  const seatsNeeded = ticket.seats_consumed * quantity;
  if (instance.spots_remaining < seatsNeeded) {
    return jsonResponse({ error: 'Not enough spaces remaining on this course' }, 409);
  }

  // --- Franchisee Stripe connection -----------------------------------------
  const frRes = await admin
    .from('da_franchisees')
    .select('id, number, name, email, stripe_account_id, stripe_connected')
    .eq('id', instance.franchisee_id)
    .single();
  if (frRes.error || !frRes.data) {
    console.error('franchisee lookup failed', frRes.error);
    return jsonResponse({ error: 'Could not resolve the course owner' }, 500);
  }
  const franchisee = frRes.data as any;
  if (!franchisee.stripe_connected || !franchisee.stripe_account_id) {
    return jsonResponse({ error: 'Online payment is not set up for this course yet' }, 400);
  }

  // --- Pricing + discount ---------------------------------------------------
  const grossPence = ticket.price_pence * quantity;
  let discountCode: string | null = null;
  let discountOffPence = 0;
  const codeInput = reqStr(body.discount_code);
  if (codeInput) {
    const code = codeInput.toUpperCase();
    const dRes = await admin
      .from('da_discount_codes')
      .select(
        'code, franchisee_id, type, value, max_uses, uses_count, valid_from, valid_until, is_active, template_ids',
      )
      .eq('code', code)
      .maybeSingle();
    const d = dRes.data as any;
    const now = Date.now();
    const usable =
      d &&
      d.is_active &&
      (!d.valid_from || new Date(d.valid_from).getTime() <= now) &&
      (!d.valid_until || new Date(d.valid_until).getTime() >= now) &&
      (d.max_uses == null || d.uses_count < d.max_uses) &&
      (!d.franchisee_id || d.franchisee_id === instance.franchisee_id) &&
      // Round 2 (G10, migration 046): NULL or empty template_ids means the code
      // works on any course type; otherwise this course's type must be listed.
      (!Array.isArray(d.template_ids) ||
        d.template_ids.length === 0 ||
        d.template_ids.includes(instance.template_id));
    if (usable) {
      discountCode = d.code;
      discountOffPence = discountOff(d.type, d.value, grossPence);
    }
    // An unusable code is silently ignored (full price) — the widget validates
    // live before submit, so this is only a defensive backstop.
  }
  const netPence = Math.max(0, grossPence - discountOffPence);
  const applicationFee = Math.floor((netPence * feePercent) / 100);

  // --- Upsert customer ------------------------------------------------------
  const custRes = await admin
    .from('da_customers')
    .upsert(
      { email, first_name: firstName, last_name: lastName, phone, postcode },
      { onConflict: 'email', ignoreDuplicates: false },
    )
    .select('id')
    .single();
  if (custRes.error || !custRes.data) {
    console.error('customer upsert failed', custRes.error);
    return jsonResponse({ error: 'Could not save your details' }, 500);
  }
  const customerId = (custRes.data as any).id;

  // --- Resolve client (email dedup) -----------------------------------------
  // org set at scheduling → else match individual by email → else create one.
  let privateClientId: string | null = instance.private_client_id ?? null;
  if (!privateClientId) {
    const match = await admin
      .from('da_private_clients')
      .select('id')
      .eq('franchisee_id', instance.franchisee_id)
      .eq('client_type', 'individual')
      .ilike('contact_email', email)
      .maybeSingle();
    if (match.data) {
      privateClientId = (match.data as any).id;
    } else {
      const created = await admin
        .from('da_private_clients')
        .insert({
          franchisee_id: instance.franchisee_id,
          client_type: 'individual',
          company_name: null,
          contact_name: `${firstName} ${lastName}`,
          contact_email: email,
          contact_phone: phone,
        })
        .select('id')
        .maybeSingle();
      // A race (two concurrent first-time bookings) can lose the unique index;
      // re-fetch on failure rather than erroring the booking.
      if (created.data) privateClientId = (created.data as any).id;
      else {
        const refetch = await admin
          .from('da_private_clients')
          .select('id')
          .eq('franchisee_id', instance.franchisee_id)
          .eq('client_type', 'individual')
          .ilike('contact_email', email)
          .maybeSingle();
        privateClientId = (refetch.data as any)?.id ?? null;
        if (!privateClientId) {
          // Insert lost AND refetch missed — never proceed with a null
          // linkage (breaks client attribution). Ask the user to retry.
          const requestId = newRequestId();
          await logSystem(admin, {
            level: 'error',
            source: 'create-checkout-session',
            requestId,
            message: 'private client insert and refetch both failed',
            context: {
              insert_error: created.error?.message ?? null,
              franchisee_id: instance.franchisee_id,
            },
          });
          return jsonResponse(
            { error: 'Could not save your details — please try again', request_id: requestId },
            500,
          );
        }
      }
    }
  }

  // --- Booking reference + PENDING booking ----------------------------------
  const refRes = await admin.rpc('next_booking_reference', {
    franchisee_number: franchisee.number,
  });
  if (refRes.error || !refRes.data) {
    console.error('next_booking_reference failed', refRes.error);
    return jsonResponse({ error: 'Could not start your booking' }, 500);
  }
  const bookingReference = refRes.data as string;

  // --- Reserve the spots (migration 035) -------------------------------------
  // Atomic conditional hold: two concurrent checkouts can no longer both pay
  // for the last spot. Released by the rollback below, or by the hourly
  // pending-expiry sweep (send-emails) if the checkout is abandoned.
  const reserve = await admin.rpc('reserve_spots', {
    instance_id: instance.id,
    seats: seatsNeeded,
  });
  if (reserve.error) {
    const requestId = newRequestId();
    await logSystem(admin, {
      level: 'error',
      source: 'create-checkout-session',
      requestId,
      entityType: 'course_instance',
      entityId: instance.id,
      message: `reserve_spots failed: ${reserve.error.message}`,
    });
    return jsonResponse(
      { error: 'Could not reserve your places — please try again', request_id: requestId },
      500,
    );
  }
  if (reserve.data !== true) {
    return jsonResponse({ error: 'Not enough spaces remaining on this course' }, 409);
  }
  const releaseHold = () =>
    admin.rpc('release_spots', { instance_id: instance.id, seats: seatsNeeded });

  const bookingRes = await admin
    .from('da_bookings')
    .insert({
      booking_reference: bookingReference,
      course_instance_id: instance.id,
      franchisee_id: instance.franchisee_id,
      customer_id: customerId,
      private_client_id: privateClientId,
      ticket_type_id: ticketTypeId,
      quantity,
      total_price_pence: netPence,
      discount_code: discountCode,
      discount_amount_pence: discountOffPence,
      payment_status: 'pending',
      booking_status: 'confirmed',
      reserved_seats: seatsNeeded,
    })
    .select('id')
    .single();
  if (bookingRes.error || !bookingRes.data) {
    await releaseHold();
    const requestId = newRequestId();
    await logSystem(admin, {
      level: 'error',
      source: 'create-checkout-session',
      requestId,
      message: `pending booking insert failed: ${bookingRes.error?.message}`,
      context: { booking_reference: bookingReference },
    });
    return jsonResponse({ error: 'Could not start your booking', request_id: requestId }, 500);
  }
  const bookingId = (bookingRes.data as any).id;

  // --- Stripe Checkout Session (direct charge on connected account) ---------
  const origin = safeOrigin(reqStr(body.origin));
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        // Without expires_at Stripe keeps the session payable for 24 HOURS,
        // but the send-emails sweep cancels the pending booking and releases
        // its seat hold at 35 minutes — a customer paying in the gap would be
        // charged for a cancelled booking. Expire the session first (31 min:
        // Stripe's minimum is 30, +1 for clock skew).
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: netPence,
              product_data: {
                name: `${ticket.name} × ${quantity}`,
                description: `Booking ${bookingReference} · ${instance.event_date}`,
              },
            },
            quantity: 1,
          },
        ],
        // Stripe rejects application_fee_amount: 0 in some flows — omit the
        // key entirely when there is no fee.
        ...(applicationFee > 0
          ? { payment_intent_data: { application_fee_amount: applicationFee } }
          : {}),
        success_url: `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}&ref=${encodeURIComponent(bookingReference)}`,
        cancel_url: `${origin}/booking/cancelled`,
        metadata: {
          booking_id: bookingId,
          course_instance_id: instance.id,
          ticket_type_id: ticketTypeId,
          quantity: String(quantity),
          franchisee_id: instance.franchisee_id,
          discount_code: discountCode ?? '',
          discount_amount_pence: String(discountOffPence),
        },
      },
      { stripeAccount: franchisee.stripe_account_id },
    );
  } catch (err: any) {
    // Roll back the orphaned pending booking and release its hold.
    await admin.from('da_bookings').delete().eq('id', bookingId);
    await releaseHold();
    const requestId = newRequestId();
    await logSystem(admin, {
      level: 'error',
      source: 'create-checkout-session',
      requestId,
      entityType: 'booking',
      entityId: bookingId,
      message: `Stripe checkout.sessions.create failed: ${typeof err?.message === 'string' ? err.message : String(err)}`,
      context: { booking_reference: bookingReference, franchisee_id: instance.franchisee_id },
    });
    return jsonResponse(
      {
        error: `Could not start payment: ${typeof err?.message === 'string' ? err.message : 'Stripe error'}`,
        request_id: requestId,
      },
      502,
    );
  }

  // Stamp the session id so the webhook can flip this pending booking.
  await admin
    .from('da_bookings')
    .update({ stripe_checkout_session_id: session.id })
    .eq('id', bookingId);

  return jsonResponse(
    { checkout_url: session.url, session_id: session.id, booking_reference: bookingReference },
    201,
  );
});

// ---------------------------------------------------------------------------
// ITEM path (migration 044) — undated products: books, kits, e-learning.
//
// Deliberately simpler than the course path: nothing to reserve (an item never
// runs out of places), no booking row, no discount codes. The ONLY record
// written here is the customer; stripe-webhook creates the da_product_sales row
// when payment lands, so an abandoned checkout leaves nothing to sweep up.
//
// Routed to the franchisee's connected account exactly as the course path is,
// and with no application fee (removed pre-launch — HQ bills monthly instead).
// ---------------------------------------------------------------------------
async function createItemSession(
  admin: ReturnType<typeof createClient>,
  body: RequestBody,
  franchiseeProductId: string,
  stripeSecretKey: string,
): Promise<Response> {
  const quantityRaw = body.quantity;
  const quantity = quantityRaw === undefined || quantityRaw === null ? 1 : quantityRaw;
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_ITEM_QUANTITY
  ) {
    return jsonResponse(
      { error: `quantity must be a whole number between 1 and ${MAX_ITEM_QUANTITY}` },
      400,
    );
  }

  const parsed = parseCustomer(body.customer ?? {});
  if (typeof parsed === 'string') return jsonResponse({ error: parsed }, 400);
  const { firstName, lastName, email, phone, postcode } = parsed;

  // --- Resolve the listing (must be online, product must be active) ---------
  const fpRes = await admin
    .from('da_franchisee_products')
    .select(
      `id, franchisee_id, product_id, price_pence, is_online,
       product:da_products ( name, description, active, kind )`,
    )
    .eq('id', franchiseeProductId)
    .maybeSingle();
  if (fpRes.error) {
    console.error('franchisee product lookup failed', fpRes.error);
    return jsonResponse({ error: 'Could not load that item' }, 500);
  }
  if (!fpRes.data) return jsonResponse({ error: 'Item not found' }, 404);
  const listing = fpRes.data as any;
  if (!listing.is_online || !listing.product?.active) {
    return jsonResponse({ error: 'That item is not currently on sale' }, 409);
  }

  // --- Franchisee Stripe connection -----------------------------------------
  const frRes = await admin
    .from('da_franchisees')
    .select('id, number, name, email, stripe_account_id, stripe_connected')
    .eq('id', listing.franchisee_id)
    .single();
  if (frRes.error || !frRes.data) {
    console.error('franchisee lookup failed', frRes.error);
    return jsonResponse({ error: 'Could not resolve the item owner' }, 500);
  }
  const franchisee = frRes.data as any;
  if (!franchisee.stripe_connected || !franchisee.stripe_account_id) {
    return jsonResponse({ error: 'Online payment is not set up for this item yet' }, 400);
  }

  // --- Upsert customer ------------------------------------------------------
  const custRes = await admin
    .from('da_customers')
    .upsert(
      { email, first_name: firstName, last_name: lastName, phone, postcode },
      { onConflict: 'email', ignoreDuplicates: false },
    )
    .select('id')
    .single();
  if (custRes.error || !custRes.data) {
    console.error('customer upsert failed', custRes.error);
    return jsonResponse({ error: 'Could not save your details' }, 500);
  }
  const customerId = (custRes.data as any).id;

  // --- Stripe Checkout Session (direct charge on connected account) ---------
  // Stripe multiplies unit_amount by line-item quantity, so the buyer sees
  // "Book × 3" priced per unit rather than one opaque total.
  const origin = safeOrigin(reqStr(body.origin));
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              unit_amount: listing.price_pence,
              product_data: {
                name: listing.product?.name ?? 'Daisy First Aid item',
                ...(listing.product?.description
                  ? { description: String(listing.product.description).slice(0, 500) }
                  : {}),
              },
            },
            quantity,
          },
        ],
        success_url: `${origin}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/shop/cancelled`,
        metadata: {
          kind: 'product',
          franchisee_product_id: listing.id,
          quantity: String(quantity),
          customer_id: customerId,
        },
      },
      { stripeAccount: franchisee.stripe_account_id },
    );
  } catch (err: any) {
    // Nothing to roll back — no booking, no hold. The customer row is a plain
    // contact record and stays regardless.
    const requestId = newRequestId();
    await logSystem(admin, {
      level: 'error',
      source: 'create-checkout-session',
      requestId,
      entityType: 'franchisee_product',
      entityId: listing.id,
      message: `Stripe item checkout.sessions.create failed: ${typeof err?.message === 'string' ? err.message : String(err)}`,
      context: { franchisee_id: listing.franchisee_id, quantity },
    });
    return jsonResponse(
      {
        error: `Could not start payment: ${typeof err?.message === 'string' ? err.message : 'Stripe error'}`,
        request_id: requestId,
      },
      502,
    );
  }

  return jsonResponse({ checkout_url: session.url, session_id: session.id }, 201);
}

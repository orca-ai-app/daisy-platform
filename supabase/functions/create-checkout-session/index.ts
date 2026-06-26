// supabase/functions/create-checkout-session/index.ts
//
// PUBLIC (no auth) — creates a Stripe Checkout Session for a public widget
// booking OR a private /book/:token booking. PRD §5.3. Serves BOTH surfaces.
//
// POST {
//   course_instance_id?: string,   // public widget passes this
//   booking_token?: string,        // /book/:token page passes this instead
//   ticket_type_id: string,
//   quantity: number,
//   customer: { first_name, last_name, email, phone?, postcode? },
//   discount_code?: string,
//   origin?: string                // caller's site origin, for success/cancel URLs
// }
// -> 201 { checkout_url, session_id, booking_reference }
//
// Flow: resolve course (by id or token) → verify scheduled + enough spaces →
// franchisee Stripe-connected → price the ticket → apply+store discount →
// upsert customer → resolve client (email dedup) → write a PENDING booking →
// create Stripe Checkout on the connected account → stamp the session id.
//
// Spots are NOT decremented here — the webhook decrements on payment (matches
// M2, avoids held seats on abandoned checkouts). uses_count is bumped at
// confirmation too. If Stripe fails, the pending booking is rolled back.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext';

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
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const feePercent = Number(Deno.env.get('PLATFORM_FEE_PERCENT') ?? '2') || 2;
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
  if (!courseInstanceId && !bookingToken) {
    return jsonResponse({ error: 'course_instance_id or booking_token is required' }, 400);
  }
  if (!ticketTypeId) return jsonResponse({ error: 'ticket_type_id is required' }, 400);

  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return jsonResponse({ error: 'quantity must be a positive integer' }, 400);
  }

  const c = body.customer ?? {};
  const firstName = reqStr(c.first_name);
  const lastName = reqStr(c.last_name);
  const emailRaw = reqStr(c.email);
  if (!firstName || !lastName) {
    return jsonResponse({ error: 'customer first_name and last_name are required' }, 400);
  }
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return jsonResponse({ error: 'a valid customer email is required' }, 400);
  }
  const email = emailRaw.toLowerCase();
  const phone = reqStr(c.phone);
  const postcode = reqStr(c.postcode);

  // --- Resolve course instance (by id or token) -----------------------------
  let q = admin
    .from('da_course_instances')
    .select(
      'id, franchisee_id, event_date, private_client_id, status, visibility, spots_remaining',
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
        'code, franchisee_id, type, value, max_uses, uses_count, valid_from, valid_until, is_active',
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
      (!d.franchisee_id || d.franchisee_id === instance.franchisee_id);
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
    })
    .select('id')
    .single();
  if (bookingRes.error || !bookingRes.data) {
    console.error('pending booking insert failed', bookingRes.error);
    return jsonResponse({ error: 'Could not start your booking' }, 500);
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
        payment_intent_data: { application_fee_amount: applicationFee },
        success_url: `${origin}/booking/success?session_id={CHECKOUT_SESSION_ID}`,
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
    // Roll back the orphaned pending booking.
    await admin.from('da_bookings').delete().eq('id', bookingId);
    console.error('Stripe checkout.sessions.create failed', err);
    return jsonResponse(
      {
        error: `Could not start payment: ${typeof err?.message === 'string' ? err.message : 'Stripe error'}`,
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

// supabase/functions/create-booking/index.ts
//
// POST {
//   course_instance_id: string (uuid),
//   ticket_type_id:     string (uuid),
//   quantity:           integer >= 1,
//   customer: { first_name, last_name, email, phone?, postcode? },
//   notes?:             string
// } -> 201 { id, booking_reference, payment_status }
//
// Records an OFFLINE booking (cheque / invoice / phone) taken outside Stripe.
// The booking is created with payment_status='pending' so it shows in the
// bookings list and can be marked paid (-> 'manual') once the money arrives.
//
// Behaviour:
//   1. Auth: JWT sub -> da_franchisees.auth_user_id -> caller row (+ is_hq).
//   2. Load the course instance. A franchisee may only book their own
//      instance; HQ (is_hq) may book on any. Cancelled courses are rejected.
//   3. Load the ticket type (must belong to the instance).
//   4. Upsert the customer by email.
//   5. Atomically decrement spots (decrement_spots). If there aren't enough,
//      reject (no overbooking for manual entry).
//   6. Generate a booking reference (next_booking_reference) for the owning
//      franchisee, insert da_bookings (payment_status='pending'), log activity.
//
// The booking is owned by the INSTANCE's franchisee (the one running the
// course), not necessarily the caller — this matters when HQ books on behalf
// of a franchisee.
//
// No Stripe IDs, no email sequence: those belong to the paid/online flow.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

function decodeJwtSub(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

function reqStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
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
  ticket_type_id?: unknown;
  quantity?: unknown;
  customer?: CustomerInput;
  notes?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // --- Auth ----------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // --- Resolve caller ------------------------------------------------------
  const callerLookup = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (callerLookup.error) {
    console.error('caller lookup failed', callerLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!callerLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }
  const caller = callerLookup.data as { id: string; name: string; is_hq: boolean };

  // --- Parse + validate body ----------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!isUuid(body.course_instance_id)) {
    return jsonResponse({ error: 'course_instance_id is required (uuid)' }, 400);
  }
  if (!isUuid(body.ticket_type_id)) {
    return jsonResponse({ error: 'ticket_type_id is required (uuid)' }, 400);
  }
  const courseInstanceId = body.course_instance_id;
  const ticketTypeId = body.ticket_type_id;

  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return jsonResponse({ error: 'quantity must be an integer of 1 or more' }, 400);
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
  const notes = reqStr(body.notes);

  // --- Load course instance ------------------------------------------------
  const instanceResult = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, event_date, private_client_id, status')
    .eq('id', courseInstanceId)
    .maybeSingle();

  if (instanceResult.error) {
    console.error('instance lookup failed', instanceResult.error);
    return jsonResponse({ error: 'Failed to load course' }, 500);
  }
  if (!instanceResult.data) {
    return jsonResponse({ error: 'Course not found' }, 404);
  }
  const instance = instanceResult.data as {
    id: string;
    franchisee_id: string;
    event_date: string;
    private_client_id: string | null;
    status: string;
  };

  // --- Authorise: own instance, or HQ -------------------------------------
  if (!caller.is_hq && instance.franchisee_id !== caller.id) {
    return jsonResponse({ error: 'You can only add bookings to your own courses' }, 403);
  }
  if (instance.status === 'cancelled') {
    return jsonResponse({ error: 'This course is cancelled — bookings cannot be added' }, 409);
  }

  // --- Load ticket type (must belong to the instance) ----------------------
  const ticketResult = await admin
    .from('da_ticket_types')
    .select('id, seats_consumed, price_pence')
    .eq('id', ticketTypeId)
    .eq('course_instance_id', courseInstanceId)
    .maybeSingle();

  if (ticketResult.error) {
    console.error('ticket lookup failed', ticketResult.error);
    return jsonResponse({ error: 'Failed to load ticket type' }, 500);
  }
  if (!ticketResult.data) {
    return jsonResponse({ error: 'Ticket type not found for this course' }, 404);
  }
  const ticket = ticketResult.data as { id: string; seats_consumed: number; price_pence: number };
  const seatsToDecrement = ticket.seats_consumed * quantity;
  const totalPricePence = ticket.price_pence * quantity;

  // --- Owning franchisee number (for the booking reference) ----------------
  const ownerResult = await admin
    .from('da_franchisees')
    .select('number')
    .eq('id', instance.franchisee_id)
    .single();
  if (ownerResult.error || !ownerResult.data) {
    console.error('owner franchisee lookup failed', ownerResult.error);
    return jsonResponse({ error: 'Failed to resolve course owner' }, 500);
  }
  const ownerNumber = (ownerResult.data as { number: string }).number;

  // --- Upsert customer -----------------------------------------------------
  const customerUpsert = await admin
    .from('da_customers')
    .upsert(
      { email, first_name: firstName, last_name: lastName, phone, postcode },
      { onConflict: 'email', ignoreDuplicates: false },
    )
    .select('id')
    .single();
  if (customerUpsert.error || !customerUpsert.data) {
    console.error('customer upsert failed', customerUpsert.error);
    return jsonResponse({ error: 'Failed to save customer' }, 500);
  }
  const customerId = (customerUpsert.data as { id: string }).id;

  // --- Atomic spot decrement (no overbooking for manual entry) -------------
  const decrement = await admin.rpc('decrement_spots', {
    instance_id: courseInstanceId,
    seats: seatsToDecrement,
  });
  if (decrement.error) {
    console.error('decrement_spots failed', decrement.error);
    return jsonResponse({ error: 'Failed to reserve seats' }, 500);
  }
  if (decrement.data !== true) {
    // Say the numbers — "not enough spaces" alone reads like a system fault
    // when the real cause is quantity × seats-per-ticket vs what's left
    // (Jenni's 75-place cheque booking, M3 feedback §10).
    const cur = await admin
      .from('da_course_instances')
      .select('spots_remaining')
      .eq('id', courseInstanceId)
      .maybeSingle();
    const left = (cur.data as { spots_remaining: number } | null)?.spots_remaining;
    const detail =
      left == null
        ? ''
        : ` This booking needs ${seatsToDecrement} space${seatsToDecrement === 1 ? '' : 's'} (${quantity} × ${ticket.seats_consumed} seat${ticket.seats_consumed === 1 ? '' : 's'} per ticket) but only ${left} ${left === 1 ? 'is' : 'are'} left. If seats-per-ticket looks wrong, check the ticket type on the course page.`;
    return jsonResponse({ error: `Not enough spaces remaining on this course.${detail}` }, 409);
  }

  // --- Booking reference ---------------------------------------------------
  const refResult = await admin.rpc('next_booking_reference', { franchisee_number: ownerNumber });
  if (refResult.error || !refResult.data) {
    console.error('next_booking_reference failed', refResult.error);
    await releaseSeats(admin, courseInstanceId, seatsToDecrement);
    return jsonResponse({ error: 'Failed to generate booking reference' }, 500);
  }
  const bookingReference = refResult.data as string;

  // --- Insert booking ------------------------------------------------------
  const bookingInsert = await admin
    .from('da_bookings')
    .insert({
      booking_reference: bookingReference,
      course_instance_id: courseInstanceId,
      franchisee_id: instance.franchisee_id,
      customer_id: customerId,
      private_client_id: instance.private_client_id ?? null,
      ticket_type_id: ticketTypeId,
      quantity,
      total_price_pence: totalPricePence,
      payment_status: 'pending',
      booking_status: 'confirmed',
      notes,
    })
    .select('id, booking_reference, payment_status')
    .single();

  if (bookingInsert.error || !bookingInsert.data) {
    console.error('booking insert failed', bookingInsert.error);
    await releaseSeats(admin, courseInstanceId, seatsToDecrement);
    return jsonResponse({ error: 'Failed to create booking' }, 500);
  }
  const booking = bookingInsert.data as {
    id: string;
    booking_reference: string;
    payment_status: string;
  };

  // --- Activity log --------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: caller.is_hq ? 'hq' : 'franchisee',
      actor_id: caller.id,
      entity_type: 'booking',
      entity_id: booking.id,
      action: 'booking_created',
      metadata: {
        booking_reference: bookingReference,
        course_instance_id: courseInstanceId,
        franchisee_id: instance.franchisee_id,
        customer_email: email,
        ticket_type_id: ticketTypeId,
        quantity,
        total_price_pence: totalPricePence,
        payment_status: 'pending',
        source: 'manual_offline',
      },
      description: `Booking ${bookingReference} created manually (offline, awaiting payment) by ${caller.name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity insert failed', r.error);
    });

  return jsonResponse(booking, 201);
});

// Best-effort compensating release if booking creation fails after the
// atomic decrement. decrement_spots only decrements, so add the seats back
// directly. Failure here is logged but not fatal (the request already failed).
async function releaseSeats(admin: any, instanceId: string, seats: number): Promise<void> {
  const cur = await admin
    .from('da_course_instances')
    .select('spots_remaining')
    .eq('id', instanceId)
    .single();
  if (cur.error || !cur.data) {
    console.error('releaseSeats: could not read spots_remaining', cur.error);
    return;
  }
  const restored = (cur.data as { spots_remaining: number }).spots_remaining + seats;
  const upd = await admin
    .from('da_course_instances')
    .update({ spots_remaining: restored })
    .eq('id', instanceId);
  if (upd.error) console.error('releaseSeats: failed to restore spots', upd.error);
}

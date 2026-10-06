// supabase/functions/transfer-booking/index.ts
//
// POST { booking_id, target_course_instance_id, notify_customer? } -> 200 updated booking row
//
// Moves a booking to another course instance run by the same franchisee
// (NTH-12). The booking keeps its reference, payment fields and quantity.
// The ticket type is re-pointed to the target course's ticket type of the
// same name when one exists; otherwise the original ticket_type_id reference
// is kept as-is and a note records the mismatch.
//
// Behaviour:
//  1. Auth: JWT sub → da_franchisees.auth_user_id → caller row (+ is_hq).
//  2. Load the booking. Ownership: booking.franchisee_id must equal the
//     caller's id (HQ may transfer any booking) → 403 if not.
//  3. Guards: cancelled bookings rejected (409); target must differ from the
//     booking's current course (409).
//  4. Validate target instance: must belong to the booking's franchisee,
//     status='scheduled', and have enough spots for the booking's seats
//     (seats_consumed × quantity, same arithmetic as create-booking).
//  5. Atomically decrement target spots (decrement_spots RPC — rejects if
//     not enough), update the booking's course_instance_id (+ matched
//     ticket_type_id), append a timestamped "Transferred from X to Y" note,
//     then add the seats back to the source instance.
//  6. INSERT da_activities (action='booking_transferred').
//  7. When notify_customer is true, queue a da_email_sequences row reusing
//     the 'booking_confirmation' template (same row shape as stripe-webhook)
//     so the customer gets a confirmation for the new course.
//  8. Return updated row.
//
// B6 basket (migration 068): a ticket line moved out of a multi-line order
// leaves that order (order_id cleared) and stands as its own booking on the
// new course, so its emails describe that course alone. The rest of the order
// stays where it was. Moving the order's lead line hands the lead (and the
// order's reminders) to the next line still on the old course. A line of an
// order still awaiting payment cannot be moved (the webhook confirms the
// order by its lead).
//
// Reminders follow the booking (October batch), notify or not: its pending
// reminders and follow-ups are re-anchored to the new course's times
// (_shared/reanchor.ts), and any pre-class reminder it is missing for the new
// course is queued: day-before for every booking, plus the "class is soon"
// reminder for an online booking (one with a booking confirmation). Nothing
// is left queued against the old course unless another line of the same
// order is still on it.
//
// NOTE: do NOT deploy — the verifier/orchestrator deploys all Edge Functions.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { lineNumber } from '../_shared/basket.ts';
import {
  POST_COURSE_KEYS,
  PRE_CLASS_KEYS,
  applyReanchor,
  missingPreClassReminders,
  planReanchor,
  type ClassTimes,
} from '../_shared/reanchor.ts';

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
    const decoded = atob(padded);
    const claims = JSON.parse(decoded) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Build the timestamp prefix for an appended note (same format as
 * add-booking-note): [YYYY-MM-DD HH:mm UTC]
 */
function buildTimestampPrefix(now: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad2(now.getUTCMonth() + 1);
  const d = pad2(now.getUTCDate());
  const hh = pad2(now.getUTCHours());
  const mm = pad2(now.getUTCMinutes());
  return `[${y}-${m}-${d} ${hh}:${mm} UTC]`;
}

interface RequestBody {
  booking_id?: unknown;
  target_course_instance_id?: unknown;
  notify_customer?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Resolve franchisee from JWT sub
  // ---------------------------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const caller = franchiseeResult.data as { id: string; name: string; is_hq: boolean };

  // ---------------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!isUuid(body.booking_id)) {
    return jsonResponse({ error: 'booking_id is required (uuid)' }, 400);
  }
  const bookingId = body.booking_id;

  if (!isUuid(body.target_course_instance_id)) {
    return jsonResponse({ error: 'target_course_instance_id is required (uuid)' }, 400);
  }
  const targetInstanceId = body.target_course_instance_id;

  const notifyCustomer = body.notify_customer === true;

  // ---------------------------------------------------------------------------
  // Load current booking row
  // ---------------------------------------------------------------------------
  const bookingResult = await admin
    .from('da_bookings')
    .select(
      'id, franchisee_id, booking_reference, booking_status, course_instance_id, customer_id, ticket_type_id, quantity, notes, order_id, payment_status',
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingResult.error) {
    console.error('booking lookup failed', bookingResult.error);
    return jsonResponse({ error: 'Failed to load booking' }, 500);
  }
  if (!bookingResult.data) {
    return jsonResponse({ error: 'Booking not found' }, 404);
  }

  const booking = bookingResult.data as {
    id: string;
    franchisee_id: string;
    booking_reference: string;
    booking_status: string;
    course_instance_id: string;
    customer_id: string;
    ticket_type_id: string;
    quantity: number;
    notes: string | null;
    order_id: string | null;
    payment_status: string;
  };

  // ---------------------------------------------------------------------------
  // Ownership check (HQ may transfer any booking)
  // ---------------------------------------------------------------------------
  if (!caller.is_hq && booking.franchisee_id !== caller.id) {
    return jsonResponse({ error: 'You do not own this booking' }, 403);
  }

  // ---------------------------------------------------------------------------
  // State guards
  // ---------------------------------------------------------------------------
  if (booking.booking_status === 'cancelled') {
    return jsonResponse({ error: 'Cancelled bookings cannot be moved.' }, 409);
  }
  if (targetInstanceId === booking.course_instance_id) {
    return jsonResponse({ error: 'The booking is already on this course.' }, 409);
  }
  if (booking.order_id && booking.payment_status === 'pending') {
    return jsonResponse(
      { error: 'This order is still waiting for payment. Move it once it has been paid.' },
      409,
    );
  }

  // ---------------------------------------------------------------------------
  // Load source + target course instances
  // ---------------------------------------------------------------------------
  const sourceResult = await admin
    .from('da_course_instances')
    .select('id, event_date, start_time, end_time')
    .eq('id', booking.course_instance_id)
    .maybeSingle();

  if (sourceResult.error || !sourceResult.data) {
    console.error('source instance lookup failed', sourceResult.error);
    return jsonResponse({ error: 'Failed to load the booking’s current course' }, 500);
  }
  const source = sourceResult.data as {
    id: string;
    event_date: string;
    start_time: string | null;
    end_time: string | null;
  };

  const targetResult = await admin
    .from('da_course_instances')
    .select('id, franchisee_id, event_date, start_time, end_time, status, spots_remaining')
    .eq('id', targetInstanceId)
    .maybeSingle();

  if (targetResult.error) {
    console.error('target instance lookup failed', targetResult.error);
    return jsonResponse({ error: 'Failed to load target course' }, 500);
  }
  if (!targetResult.data) {
    return jsonResponse({ error: 'Target course not found' }, 404);
  }
  const target = targetResult.data as {
    id: string;
    franchisee_id: string;
    event_date: string;
    start_time: string | null;
    end_time: string | null;
    status: string;
    spots_remaining: number;
  };

  // The target must be run by the same franchisee as the booking — the
  // booking reference encodes the franchisee number, so cross-franchisee
  // moves are out of scope even for HQ.
  if (target.franchisee_id !== booking.franchisee_id) {
    return jsonResponse({ error: 'The target course belongs to a different franchisee.' }, 409);
  }
  if (target.status !== 'scheduled') {
    return jsonResponse({ error: 'Bookings can only be moved to a scheduled course.' }, 409);
  }

  // ---------------------------------------------------------------------------
  // Seats: seats_consumed × quantity (same arithmetic as create-booking)
  // ---------------------------------------------------------------------------
  const ticketResult = await admin
    .from('da_ticket_types')
    .select('id, name, seats_consumed')
    .eq('id', booking.ticket_type_id)
    .maybeSingle();

  if (ticketResult.error || !ticketResult.data) {
    console.error('ticket type lookup failed', ticketResult.error);
    return jsonResponse({ error: 'Failed to load the booking’s ticket type' }, 500);
  }
  const ticket = ticketResult.data as { id: string; name: string; seats_consumed: number };
  const seats = ticket.seats_consumed * booking.quantity;

  // ---------------------------------------------------------------------------
  // Match the target's ticket type by name (may be absent — keep original ref)
  // ---------------------------------------------------------------------------
  const matchResult = await admin
    .from('da_ticket_types')
    .select('id')
    .eq('course_instance_id', targetInstanceId)
    .eq('name', ticket.name)
    .maybeSingle();

  if (matchResult.error) {
    console.error('target ticket type lookup failed', matchResult.error);
    return jsonResponse({ error: 'Failed to load target ticket types' }, 500);
  }
  const matchedTicketTypeId = (matchResult.data as { id: string } | null)?.id ?? null;

  // ---------------------------------------------------------------------------
  // Atomically take the seats on the target (no overbooking)
  // ---------------------------------------------------------------------------
  const decrement = await admin.rpc('decrement_spots', {
    instance_id: targetInstanceId,
    seats,
  });
  if (decrement.error) {
    console.error('decrement_spots failed', decrement.error);
    return jsonResponse({ error: 'Failed to reserve seats on the target course' }, 500);
  }
  if (decrement.data !== true) {
    return jsonResponse(
      {
        error: `Not enough spaces remaining on the target course. This booking needs ${seats} space${seats === 1 ? '' : 's'} (${booking.quantity} × ${ticket.seats_consumed} seat${ticket.seats_consumed === 1 ? '' : 's'} per ticket) but only ${target.spots_remaining} ${target.spots_remaining === 1 ? 'is' : 'are'} left.`,
      },
      409,
    );
  }

  // ---------------------------------------------------------------------------
  // Build appended notes (same format as add-booking-note)
  // ---------------------------------------------------------------------------
  const now = new Date();
  const prefix = buildTimestampPrefix(now);
  const noteLines = [`${prefix} Transferred from ${source.event_date} to ${target.event_date}`];
  if (!matchedTicketTypeId) {
    noteLines.push(
      `${prefix} Target course has no ticket type named '${ticket.name}' — original ticket type reference kept.`,
    );
  }
  const existingNotes = booking.notes?.trim() ?? '';
  const updatedNotes =
    existingNotes.length > 0 ? `${existingNotes}\n${noteLines.join('\n')}` : noteLines.join('\n');

  // ---------------------------------------------------------------------------
  // UPDATE da_bookings
  // ---------------------------------------------------------------------------
  const updated = await admin
    .from('da_bookings')
    .update({
      course_instance_id: targetInstanceId,
      ticket_type_id: matchedTicketTypeId ?? booking.ticket_type_id,
      notes: updatedNotes,
      updated_at: now.toISOString(),
      // Leaves its basket order (B6): it is now a booking on its own course.
      ...(booking.order_id ? { order_id: null } : {}),
    })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('booking transfer update failed', updated.error);
    await releaseSeats(admin, targetInstanceId, seats);
    return jsonResponse({ error: 'Failed to move booking' }, 500);
  }

  // ---------------------------------------------------------------------------
  // Give the seats back to the source instance (decrement_spots only ever
  // decrements, so add them back directly — same pattern as create-booking's
  // releaseSeats). Best-effort: the transfer has already happened.
  // ---------------------------------------------------------------------------
  await releaseSeats(admin, booking.course_instance_id, seats);

  // ---------------------------------------------------------------------------
  // INSERT da_activities
  // ---------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: caller.is_hq ? 'hq' : 'franchisee',
      actor_id: caller.id,
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'booking_transferred',
      metadata: {
        from_course_instance_id: booking.course_instance_id,
        to_course_instance_id: targetInstanceId,
        from_event_date: source.event_date,
        to_event_date: target.event_date,
        seats,
        ticket_type_matched: matchedTicketTypeId !== null,
        notify_customer: notifyCustomer,
      },
      description: `Booking ${booking.booking_reference} moved from ${source.event_date} to ${target.event_date} by ${caller.name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity log insert failed', r.error);
    });

  // ---------------------------------------------------------------------------
  // Reminders follow the booking to the new course (whether or not the
  // customer is notified). Best-effort: the move has already happened, so a
  // failure is logged loudly rather than undoing it.
  // ---------------------------------------------------------------------------
  try {
    await moveReminders(admin, booking, source, target, now);
  } catch (err) {
    console.error('transfer: reminders not moved', err);
    await admin
      .from('da_activities')
      .insert({
        actor_type: 'system',
        actor_id: null,
        entity_type: 'booking',
        entity_id: bookingId,
        action: 'email_reanchor_failed',
        metadata: { error: String(err).slice(0, 300), to_course_instance_id: targetInstanceId },
        description: `Reminders for booking ${booking.booking_reference} were not moved to the new course`,
      })
      .then((r: { error: unknown }) => {
        if (r.error) console.error('reanchor activity insert failed', r.error);
      });
  }

  // ---------------------------------------------------------------------------
  // Queue a fresh booking confirmation for the new course (optional).
  // Same row shape as stripe-webhook's da_email_sequences inserts.
  // ---------------------------------------------------------------------------
  if (notifyCustomer) {
    const emailInsert = await admin.from('da_email_sequences').insert({
      customer_id: booking.customer_id,
      booking_id: bookingId,
      template_key: 'booking_confirmation',
      sequence_day: 0,
      scheduled_for: now.toISOString(),
      status: 'pending',
    });
    if (emailInsert.error) {
      console.error('transfer confirmation email queue failed', emailInsert.error);
    }
  }

  return jsonResponse(updated.data, 200);
});

// Add seats back to an instance (compensating action / source release).
// decrement_spots only decrements, so write the restored value directly.
// Failure here is logged but not fatal.
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

/** Whether a booking had the online email journey (a booking confirmation). */
async function hadOnlineJourney(admin: any, bookingId: string): Promise<boolean> {
  const r = await admin
    .from('da_email_sequences')
    .select('id')
    .eq('booking_id', bookingId)
    .eq('template_key', 'booking_confirmation')
    .limit(1);
  if (r.error) throw new Error(`journey lookup failed: ${r.error.message}`);
  return (r.data ?? []).length > 0;
}

/**
 * Re-anchor a booking's pending class emails to `cls` and queue any pre-class
 * reminder it is missing there.
 */
async function anchorBookingTo(
  admin: any,
  bookingId: string,
  customerId: string,
  cls: ClassTimes,
  online: boolean,
  now: Date,
): Promise<void> {
  const queued = await admin
    .from('da_email_sequences')
    .select('id, template_key, scheduled_for')
    .eq('booking_id', bookingId)
    .eq('status', 'pending')
    .in('template_key', [...PRE_CLASS_KEYS, ...POST_COURSE_KEYS]);
  if (queued.error) throw new Error(`queue lookup failed: ${queued.error.message}`);
  const rows = (queued.data ?? []) as Array<{
    id: string;
    template_key: string;
    scheduled_for: string;
  }>;
  const applied = await applyReanchor(admin, planReanchor(rows, cls, now));
  if (applied.error) throw new Error(applied.error);
  const add = missingPreClassReminders(
    rows.map((r) => r.template_key),
    online ? PRE_CLASS_KEYS : ['day_before_reminder'],
    cls,
    now,
  );
  if (add.length > 0) {
    const ins = await admin.from('da_email_sequences').insert(
      add.map((a) => ({
        customer_id: customerId,
        booking_id: bookingId,
        template_key: a.template_key,
        sequence_day: 0,
        scheduled_for: a.scheduled_for,
        status: 'pending',
      })),
    );
    if (ins.error) throw new Error(`reminder queue failed: ${ins.error.message}`);
  }
}

/**
 * The moved booking's reminders now follow the target course. For a line of a
 * basket order the order's emails live on its lead line, so:
 *   - a moved non-lead line has none of its own: it gets the lead's kind of
 *     reminders for the new course, and the lead keeps the order's reminders
 *     for the old course (send-emails stops them if every line there is
 *     cancelled);
 *   - a moved lead takes its own reminders to the new course, and the next
 *     line still on the old course becomes the order's lead, with the order's
 *     items and its own pre-class reminders for the old course.
 */
async function moveReminders(
  admin: any,
  booking: { id: string; customer_id: string; order_id: string | null; booking_reference: string },
  source: { id: string; event_date: string; start_time: string | null; end_time: string | null },
  target: { event_date: string; start_time: string | null; end_time: string | null },
  now: Date,
): Promise<void> {
  const targetTimes: ClassTimes = {
    eventDate: target.event_date,
    startTime: target.start_time,
    endTime: target.end_time,
  };
  const leadId = booking.order_id ?? booking.id;
  const online = await hadOnlineJourney(admin, leadId);
  await anchorBookingTo(admin, booking.id, booking.customer_id, targetTimes, online, now);

  if (booking.order_id !== booking.id) return; // single booking or non-lead line

  // The lead has left: hand the order to the next line still on the old course.
  const rest = await admin
    .from('da_bookings')
    .select('id, booking_reference, customer_id, booking_status, course_instance_id')
    .eq('order_id', booking.id)
    .neq('id', booking.id);
  if (rest.error) throw new Error(`order lines lookup failed: ${rest.error.message}`);
  const lines = ((rest.data ?? []) as any[])
    .filter((l) => l.course_instance_id === source.id)
    .sort(
      (a, b) =>
        lineNumber(a.booking_reference, booking.booking_reference) -
        lineNumber(b.booking_reference, booking.booking_reference),
    );
  if (lines.length === 0) return;
  const newLead = lines.find((l) => l.booking_status !== 'cancelled') ?? lines[0];

  const lead = await admin.from('da_bookings').select('order_items').eq('id', booking.id).single();
  if (lead.error) throw new Error(`order items lookup failed: ${lead.error.message}`);
  const regroup = await admin
    .from('da_bookings')
    .update({ order_id: newLead.id })
    .eq('order_id', booking.id)
    .neq('id', booking.id);
  if (regroup.error) throw new Error(`order regroup failed: ${regroup.error.message}`);
  if ((lead.data as any)?.order_items) {
    await admin
      .from('da_bookings')
      .update({ order_items: (lead.data as any).order_items })
      .eq('id', newLead.id);
    await admin.from('da_bookings').update({ order_items: null }).eq('id', booking.id);
  }
  await anchorBookingTo(
    admin,
    newLead.id,
    newLead.customer_id,
    { eventDate: source.event_date, startTime: source.start_time, endTime: source.end_time },
    online,
    now,
  );
}

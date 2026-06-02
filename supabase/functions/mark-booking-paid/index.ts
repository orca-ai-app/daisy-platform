// supabase/functions/mark-booking-paid/index.ts
//
// POST { booking_id, payment_reference, paid_at? } -> 200 updated booking row
//
// Marks a pending booking as manually paid (payment_status='manual').
//
// Behaviour:
//  1. Auth: JWT sub → da_franchisees.auth_user_id → franchisee row.
//  2. Load the target booking row.
//  3. Ownership: booking.franchisee_id must equal the caller's id → 403 if not.
//  4. State guard: booking.payment_status must be 'pending' → 409 if already paid/manual/etc.
//  5. UPDATE da_bookings: payment_status='manual', updated_at stamped.
//  6. INSERT da_activities (action='booking_marked_paid', metadata={payment_reference, paid_at}).
//  7. Return updated row.
//
// NOTE: do NOT deploy — the verifier/orchestrator deploys all Edge Functions.

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

interface RequestBody {
  booking_id?: unknown;
  payment_reference?: unknown;
  paid_at?: unknown;
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
    .select('id, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = franchiseeResult.data as { id: string; name: string };

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

  if (
    typeof body.payment_reference !== 'string' ||
    (body.payment_reference as string).trim().length === 0
  ) {
    return jsonResponse({ error: 'payment_reference is required (non-empty string)' }, 400);
  }
  const paymentReference = (body.payment_reference as string).trim();

  // paid_at is optional; default to now if omitted or invalid.
  let paidAt: string;
  if (typeof body.paid_at === 'string' && (body.paid_at as string).trim().length > 0) {
    paidAt = (body.paid_at as string).trim();
  } else {
    paidAt = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Load current booking row
  // ---------------------------------------------------------------------------
  const bookingResult = await admin
    .from('da_bookings')
    .select('id, franchisee_id, payment_status, booking_reference')
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
    payment_status: string;
    booking_reference: string;
  };

  // ---------------------------------------------------------------------------
  // Ownership check
  // ---------------------------------------------------------------------------
  if (booking.franchisee_id !== franchisee.id) {
    return jsonResponse({ error: 'You do not own this booking' }, 403);
  }

  // ---------------------------------------------------------------------------
  // State guard: only 'pending' bookings may be marked paid
  // ---------------------------------------------------------------------------
  if (booking.payment_status !== 'pending') {
    return jsonResponse(
      {
        error: `Booking cannot be marked as paid — current payment_status is '${booking.payment_status}'. Only 'pending' bookings may be marked paid.`,
      },
      409,
    );
  }

  // ---------------------------------------------------------------------------
  // UPDATE da_bookings
  // ---------------------------------------------------------------------------
  const updated = await admin
    .from('da_bookings')
    .update({
      payment_status: 'manual',
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('booking update failed', updated.error);
    return jsonResponse({ error: 'Failed to update booking' }, 500);
  }

  // ---------------------------------------------------------------------------
  // INSERT da_activities
  // ---------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'booking_marked_paid',
      metadata: {
        payment_reference: paymentReference,
        paid_at: paidAt,
      },
      description: `Booking ${booking.booking_reference} marked as manually paid (ref: ${paymentReference})`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity log insert failed', r.error);
    });

  return jsonResponse(updated.data, 200);
});

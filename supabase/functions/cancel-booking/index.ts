// supabase/functions/cancel-booking/index.ts
//
// POST { booking_id, cancellation_reason, refund_amount_pence? } -> 200 updated booking row
//
// Cancels a booking by setting booking_status='cancelled' and recording
// the reason and any expected refund amount. This function does NOT trigger
// a Stripe refund — the franchisee processes that in their Stripe dashboard
// (out of M2 scope). The refund_amount_pence here is a record-only flag so
// HQ can reconcile what was owed.
//
// Behaviour:
//  1. Auth: JWT sub → da_franchisees.auth_user_id → franchisee row.
//  2. Load the target booking row.
//  3. Ownership: booking.franchisee_id must equal caller's id → 403 if not.
//  4. State guard: already-cancelled bookings return 409 (idempotency guard).
//  5. UPDATE da_bookings: booking_status='cancelled', cancellation_reason,
//     refund_amount_pence (if supplied and > 0); stamp updated_at.
//  6. INSERT da_activities (action='booking_cancelled').
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
  cancellation_reason?: unknown;
  refund_amount_pence?: unknown;
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
    typeof body.cancellation_reason !== 'string' ||
    (body.cancellation_reason as string).trim().length === 0
  ) {
    return jsonResponse({ error: 'cancellation_reason is required (non-empty string)' }, 400);
  }
  const cancellationReason = (body.cancellation_reason as string).trim();

  // refund_amount_pence is optional. Must be a non-negative integer if supplied.
  let refundAmountPence: number | null = null;
  if (body.refund_amount_pence !== undefined && body.refund_amount_pence !== null) {
    if (
      typeof body.refund_amount_pence !== 'number' ||
      !Number.isInteger(body.refund_amount_pence) ||
      (body.refund_amount_pence as number) < 0
    ) {
      return jsonResponse(
        { error: 'refund_amount_pence must be a non-negative integer (pence)' },
        400,
      );
    }
    refundAmountPence = body.refund_amount_pence as number;
  }

  // ---------------------------------------------------------------------------
  // Load current booking row
  // ---------------------------------------------------------------------------
  const bookingResult = await admin
    .from('da_bookings')
    .select('id, franchisee_id, booking_reference, booking_status, total_price_pence')
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
    total_price_pence: number;
  };

  // ---------------------------------------------------------------------------
  // Ownership check
  // ---------------------------------------------------------------------------
  if (booking.franchisee_id !== franchisee.id) {
    return jsonResponse({ error: 'You do not own this booking' }, 403);
  }

  // ---------------------------------------------------------------------------
  // State guard: already-cancelled bookings are rejected (not idempotent —
  // re-cancelling with a different reason or refund amount would silently
  // overwrite an existing record; safer to surface a clear error).
  // ---------------------------------------------------------------------------
  if (booking.booking_status === 'cancelled') {
    return jsonResponse({ error: 'Booking is already cancelled.' }, 409);
  }

  // ---------------------------------------------------------------------------
  // Build update payload
  // ---------------------------------------------------------------------------
  const updatePayload: Record<string, unknown> = {
    booking_status: 'cancelled',
    cancellation_reason: cancellationReason,
    updated_at: new Date().toISOString(),
  };

  // Only stamp refund_amount_pence when a positive value is supplied.
  // Zero is treated as "no refund flagged" — leave the existing DB default of 0.
  if (refundAmountPence !== null && refundAmountPence > 0) {
    updatePayload.refund_amount_pence = refundAmountPence;
  }

  // ---------------------------------------------------------------------------
  // UPDATE da_bookings
  // ---------------------------------------------------------------------------
  const updated = await admin
    .from('da_bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('booking cancel failed', updated.error);
    return jsonResponse({ error: 'Failed to cancel booking' }, 500);
  }

  // ---------------------------------------------------------------------------
  // INSERT da_activities
  // ---------------------------------------------------------------------------
  const activityMetadata: Record<string, unknown> = {
    cancellation_reason: cancellationReason,
  };
  if (refundAmountPence !== null && refundAmountPence > 0) {
    activityMetadata.refund_amount_pence = refundAmountPence;
    activityMetadata.refund_note =
      'Record-only flag. Franchisee processes actual refund via Stripe dashboard.';
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'booking',
      entity_id: bookingId,
      action: 'booking_cancelled',
      metadata: activityMetadata,
      description: `Booking ${booking.booking_reference} cancelled — reason: ${cancellationReason}`,
    })
    .catch((err: unknown) => {
      console.error('activity log insert failed', err);
    });

  return jsonResponse(updated.data, 200);
});

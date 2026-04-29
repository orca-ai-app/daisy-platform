// supabase/functions/cancel-course-instance/index.ts
//
// POST { id: string, fields: { cancellation_reason: string } } ->
//   { instance: <row>, bookings_affected: <count> }
//
// Reference: docs/PRD-technical.md §4.5 (da_course_instances), §4.9
// (da_bookings), §4.15 (da_activities), docs/M1-build-plan.md §6 Wave
// 4 Agent 4B.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. JWT `sub` claim is matched
//    against da_franchisees.auth_user_id; only HQ may proceed.
//  - Sets status='cancelled' + stamps cancellation_reason.
//  - Counts bookings linked to the instance (any status) and returns
//    the count so the UI can show "n bookings affected".
//  - Does NOT cancel the bookings or trigger refunds — that's M2/M3.
//  - Idempotent: cancelling an already-cancelled instance returns the
//    current row + count without re-stamping.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  id?: string;
  fields?: { cancellation_reason?: unknown };
}

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
    const claims = JSON.parse(decoded);
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

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

  // ---------------------------------------------------------------------
  // HQ check
  // ---------------------------------------------------------------------
  const actor = await admin
    .from('da_franchisees')
    .select('id, is_hq, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (actor.error) {
    console.error('franchisee lookup failed', actor.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!actor.data) {
    return jsonResponse({ error: 'Caller is not provisioned' }, 403);
  }
  if (!actor.data.is_hq) {
    return jsonResponse({ error: 'HQ access required' }, 403);
  }

  // ---------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.id || typeof body.id !== 'string' || !isUuid(body.id)) {
    return jsonResponse({ error: 'id is required (uuid)' }, 400);
  }
  if (!body.fields || typeof body.fields !== 'object') {
    return jsonResponse({ error: 'fields is required (object)' }, 400);
  }
  const reason = body.fields.cancellation_reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return jsonResponse(
      { error: 'fields.cancellation_reason is required (non-empty string)' },
      400,
    );
  }

  // ---------------------------------------------------------------------
  // Read current row
  // ---------------------------------------------------------------------
  const before = await admin
    .from('da_course_instances')
    .select('*')
    .eq('id', body.id)
    .maybeSingle();

  if (before.error) {
    console.error('course instance lookup failed', before.error);
    return jsonResponse({ error: 'Failed to load course instance' }, 500);
  }
  if (!before.data) {
    return jsonResponse({ error: 'Course instance not found' }, 404);
  }

  const beforeRow = before.data as Record<string, unknown>;

  // Count bookings against this instance (any status — informational).
  const bookingsCountQuery = await admin
    .from('da_bookings')
    .select('id', { count: 'exact', head: true })
    .eq('course_instance_id', body.id);

  if (bookingsCountQuery.error) {
    console.error('bookings count failed', bookingsCountQuery.error);
    return jsonResponse({ error: 'Failed to count bookings' }, 500);
  }
  const bookingsAffected = bookingsCountQuery.count ?? 0;

  // Idempotent: if already cancelled, return current row + count.
  if (beforeRow.status === 'cancelled') {
    return jsonResponse(
      { instance: before.data, bookings_affected: bookingsAffected, already_cancelled: true },
      200,
    );
  }

  // ---------------------------------------------------------------------
  // Apply cancel + activity log
  // ---------------------------------------------------------------------
  const trimmedReason = (reason as string).trim();
  const updated = await admin
    .from('da_course_instances')
    .update({
      status: 'cancelled',
      cancellation_reason: trimmedReason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .select('*')
    .single();

  if (updated.error) {
    console.error('course instance cancel failed', updated.error);
    return jsonResponse({ error: 'Failed to cancel course instance' }, 500);
  }

  const updatedRow = updated.data as Record<string, unknown>;
  const venuePostcode =
    (updatedRow.venue_postcode as string) ?? (beforeRow.venue_postcode as string) ?? '';
  const eventDate = (updatedRow.event_date as string) ?? (beforeRow.event_date as string) ?? '';

  const description = `Course at ${venuePostcode} on ${eventDate} cancelled — reason: ${trimmedReason}`;

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'course_instance',
    entity_id: body.id,
    action: 'course_instance_cancelled',
    metadata: {
      cancellation_reason: trimmedReason,
      bookings_affected: bookingsAffected,
    },
    description,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse({ instance: updated.data, bookings_affected: bookingsAffected }, 200);
});

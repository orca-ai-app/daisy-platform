// supabase/functions/update-interest-form/index.ts
//
// POST { id: string, fields: Partial<InterestFormUpdate> } -> updated row
//
// Reference: docs/PRD-technical.md §4.11 (da_interest_forms), §4.15 (da_activities),
// docs/M1-build-plan.md §6 Wave 3 Agent 3C.
//
// Behaviour mirrors update-template:
//  - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//    proceed. Non-HQ users get 403.
//  - Uses service_role to UPDATE da_interest_forms. Allowed columns:
//    status, assigned_freelancer, notes. Any other key in `fields` is rejected
//    as 400.
//  - status is constrained to PRD §4.11 CHECK list: new, contacted, booked,
//    declined, expired.
//  - Inserts a da_activities row with the diff (before / after / changed_fields)
//    and a human-readable description.
//  - Returns 4xx for bad input, 401/403 for auth failures, 5xx for DB issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FIELDS = new Set(['status', 'assigned_freelancer', 'notes']);
const ALLOWED_STATUSES = new Set(['new', 'contacted', 'booked', 'declined', 'expired']);

interface RequestBody {
  id?: string;
  fields?: Record<string, unknown>;
}

interface ErrorResponse {
  error: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): string | null {
  // No signature verification here — the function is invoked through the
  // Supabase gateway which validates the JWT before our code runs (verify_jwt
  // is on by default). We just need the `sub` claim to look up the actor.
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

function summariseChanges(
  changedFields: Record<string, unknown>,
  beforeSnapshot: Record<string, unknown>,
  postcode: string,
): string {
  const keys = Object.keys(changedFields);
  if (keys.length === 0) return `Interest form for ${postcode} updated`;

  if (keys.length === 1) {
    const key = keys[0];
    if (key === 'status') {
      return `Interest form for ${postcode} - status changed from ${beforeSnapshot.status as string} to ${changedFields.status as string}`;
    }
    if (key === 'assigned_freelancer') {
      const next = changedFields.assigned_freelancer;
      return next
        ? `Interest form for ${postcode} - assigned to ${next as string}`
        : `Interest form for ${postcode} - assignment cleared`;
    }
    if (key === 'notes') {
      return `Interest form for ${postcode} - notes updated`;
    }
    return `Interest form for ${postcode} - ${key} updated`;
  }

  return `Interest form for ${postcode} - ${keys.join(', ')} updated`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return jsonResponse({ error: 'Method not allowed' } as ErrorResponse, 405);
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

  const fields = body.fields as Record<string, unknown>;
  const updateFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return jsonResponse({ error: `Field not editable: ${key}` }, 400);
    }
    updateFields[key] = value;
  }

  if (Object.keys(updateFields).length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  // Type-shape sanity (DB CHECK constraint catches the rest).
  if ('status' in updateFields) {
    if (typeof updateFields.status !== 'string' || !ALLOWED_STATUSES.has(updateFields.status)) {
      return jsonResponse(
        { error: 'status must be one of: new, contacted, booked, declined, expired' },
        400,
      );
    }
  }
  if (
    'assigned_freelancer' in updateFields &&
    updateFields.assigned_freelancer !== null &&
    typeof updateFields.assigned_freelancer !== 'string'
  ) {
    return jsonResponse({ error: 'assigned_freelancer must be a string or null' }, 400);
  }
  if (
    'notes' in updateFields &&
    updateFields.notes !== null &&
    typeof updateFields.notes !== 'string'
  ) {
    return jsonResponse({ error: 'notes must be a string or null' }, 400);
  }

  // ---------------------------------------------------------------------
  // Read current row (for the activity diff)
  // ---------------------------------------------------------------------
  const before = await admin.from('da_interest_forms').select('*').eq('id', body.id).maybeSingle();

  if (before.error) {
    console.error('interest form lookup failed', before.error);
    return jsonResponse({ error: 'Failed to load interest form' }, 500);
  }
  if (!before.data) {
    return jsonResponse({ error: 'Interest form not found' }, 404);
  }

  // Build the changed-fields diff (only entries that actually changed).
  const changedFields: Record<string, unknown> = {};
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};
  for (const [key, newValue] of Object.entries(updateFields)) {
    const oldValue = (before.data as Record<string, unknown>)[key];
    // Treat null and undefined as equivalent to avoid spurious diffs.
    const normalisedOld = oldValue ?? null;
    const normalisedNew = newValue ?? null;
    if (normalisedOld !== normalisedNew) {
      changedFields[key] = newValue;
      beforeSnapshot[key] = oldValue;
      afterSnapshot[key] = newValue;
    }
  }

  if (Object.keys(changedFields).length === 0) {
    // No-op update — return current row, skip activity log.
    return jsonResponse(before.data, 200);
  }

  // ---------------------------------------------------------------------
  // Apply update + activity log
  // ---------------------------------------------------------------------
  const updated = await admin
    .from('da_interest_forms')
    .update({ ...changedFields, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .single();

  if (updated.error) {
    console.error('interest form update failed', updated.error);
    return jsonResponse({ error: 'Failed to update interest form' }, 500);
  }

  const postcode = (updated.data as any).postcode ?? (before.data as any).postcode ?? 'unknown';
  const description = summariseChanges(changedFields, beforeSnapshot, postcode);

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'interest_form',
    entity_id: body.id,
    action: 'interest_form_updated',
    metadata: {
      changed_fields: changedFields,
      before: beforeSnapshot,
      after: afterSnapshot,
    },
    description,
  });

  if (activityInsert.error) {
    // Audit failure must never silently lose the change but the user already
    // saw their edit succeed. Log loudly.
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});

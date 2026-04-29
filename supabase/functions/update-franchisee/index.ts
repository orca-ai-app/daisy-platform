// supabase/functions/update-franchisee/index.ts
//
// POST { id: string, fields: Partial<FranchiseeUpdate> } -> updated franchisee row
//
// Reference: docs/PRD-technical.md §4.2 (da_franchisees), §4.15 (da_activities),
// docs/M1-build-plan.md §6 Wave 4 Agent 4A.
//
// Behaviour mirrors update-template / update-interest-form:
//  - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//    proceed. Non-HQ users get 403.
//  - Uses service_role to UPDATE da_franchisees. Allowed columns:
//    name, email, phone, fee_tier, billing_date, status, notes, vat_registered,
//    is_hq. Any other key in `fields` is rejected as 400.
//  - If `email` changes, the linked auth.users row is updated via the admin
//    API so sign-in still works.
//  - HQ guard: an HQ user cannot demote themselves out of HQ (`is_hq=false`)
//    if they're the sole HQ row; returns 400.
//  - Inserts a da_activities row with the diff (before / after / changed_fields)
//    and a human-readable description.
//  - Returns 4xx for bad input, 401/403 for auth failures, 5xx for DB issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FIELDS = new Set([
  'name',
  'email',
  'phone',
  'fee_tier',
  'billing_date',
  'status',
  'notes',
  'vat_registered',
  'is_hq',
]);

const ALLOWED_STATUSES = new Set(['active', 'paused', 'terminated']);
const ALLOWED_FEE_TIERS = new Set([100, 120]);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  franchiseeName: string,
): string {
  const keys = Object.keys(changedFields);
  if (keys.length === 0) return `Franchisee ${franchiseeName} updated`;

  if (keys.length === 1) {
    const key = keys[0];
    if (key === 'status') {
      return `Franchisee ${franchiseeName} status changed from ${beforeSnapshot.status as string} to ${changedFields.status as string}`;
    }
    if (key === 'fee_tier') {
      return `Franchisee ${franchiseeName} fee tier changed from £${beforeSnapshot.fee_tier} to £${changedFields.fee_tier}`;
    }
    if (key === 'is_hq') {
      return changedFields.is_hq
        ? `Franchisee ${franchiseeName} promoted to HQ`
        : `Franchisee ${franchiseeName} demoted from HQ`;
    }
    if (key === 'email') {
      return `Franchisee ${franchiseeName} email changed to ${changedFields.email as string}`;
    }
    return `Franchisee ${franchiseeName} - ${key} updated`;
  }

  return `Franchisee ${franchiseeName} - ${keys.join(', ')} updated`;
}

async function adminUpdateUserEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  authUserId: string,
  newEmail: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const url = `${supabaseUrl}/auth/v1/admin/users/${authUserId}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email: newEmail,
      email_confirm: true,
    }),
  });

  if (!response.ok) {
    let message = `auth admin update failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        msg?: string;
        error_description?: string;
        message?: string;
      };
      if (body.msg) message = body.msg;
      else if (body.error_description) message = body.error_description;
      else if (body.message) message = body.message;
    } catch {
      // body wasn't JSON
    }
    return { ok: false, status: response.status, error: message };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
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
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.id || typeof body.id !== 'string' || !isUuid(body.id)) {
    return jsonResponse({ error: 'id is required (uuid)' }, 400);
  }
  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
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

  // Type-shape validation per field.
  if (
    'name' in updateFields &&
    (typeof updateFields.name !== 'string' || (updateFields.name as string).trim().length < 2)
  ) {
    return jsonResponse({ error: 'name must be a string of at least 2 characters' }, 400);
  }
  if (
    'email' in updateFields &&
    (typeof updateFields.email !== 'string' || !EMAIL_REGEX.test(updateFields.email as string))
  ) {
    return jsonResponse({ error: 'email must be a valid email address' }, 400);
  }
  if (
    'phone' in updateFields &&
    updateFields.phone !== null &&
    typeof updateFields.phone !== 'string'
  ) {
    return jsonResponse({ error: 'phone must be a string or null' }, 400);
  }
  if (
    'fee_tier' in updateFields &&
    (typeof updateFields.fee_tier !== 'number' ||
      !Number.isInteger(updateFields.fee_tier) ||
      !ALLOWED_FEE_TIERS.has(updateFields.fee_tier as number))
  ) {
    return jsonResponse({ error: 'fee_tier must be 100 or 120' }, 400);
  }
  if (
    'billing_date' in updateFields &&
    (typeof updateFields.billing_date !== 'number' ||
      !Number.isInteger(updateFields.billing_date) ||
      (updateFields.billing_date as number) < 1 ||
      (updateFields.billing_date as number) > 28)
  ) {
    return jsonResponse({ error: 'billing_date must be an integer between 1 and 28' }, 400);
  }
  if (
    'status' in updateFields &&
    (typeof updateFields.status !== 'string' ||
      !ALLOWED_STATUSES.has(updateFields.status as string))
  ) {
    return jsonResponse({ error: 'status must be one of: active, paused, terminated' }, 400);
  }
  if (
    'notes' in updateFields &&
    updateFields.notes !== null &&
    typeof updateFields.notes !== 'string'
  ) {
    return jsonResponse({ error: 'notes must be a string or null' }, 400);
  }
  if ('vat_registered' in updateFields && typeof updateFields.vat_registered !== 'boolean') {
    return jsonResponse({ error: 'vat_registered must be a boolean' }, 400);
  }
  if ('is_hq' in updateFields && typeof updateFields.is_hq !== 'boolean') {
    return jsonResponse({ error: 'is_hq must be a boolean' }, 400);
  }

  // Normalise text fields.
  if (typeof updateFields.name === 'string') {
    updateFields.name = (updateFields.name as string).trim();
  }
  if (typeof updateFields.email === 'string') {
    updateFields.email = (updateFields.email as string).trim().toLowerCase();
  }
  if (typeof updateFields.phone === 'string') {
    const trimmed = (updateFields.phone as string).trim();
    updateFields.phone = trimmed.length === 0 ? null : trimmed;
  }
  if (typeof updateFields.notes === 'string') {
    const trimmed = (updateFields.notes as string).trim();
    updateFields.notes = trimmed.length === 0 ? null : trimmed;
  }

  // ---------------------------------------------------------------------
  // Read current row (for the activity diff + auth_user_id)
  // ---------------------------------------------------------------------
  const before = await admin.from('da_franchisees').select('*').eq('id', body.id).maybeSingle();

  if (before.error) {
    console.error('franchisee lookup failed', before.error);
    return jsonResponse({ error: 'Failed to load franchisee' }, 500);
  }
  if (!before.data) {
    return jsonResponse({ error: 'Franchisee not found' }, 404);
  }

  // ---------------------------------------------------------------------
  // HQ guard: don't allow demoting the last HQ row out of HQ.
  // ---------------------------------------------------------------------
  if ('is_hq' in updateFields && updateFields.is_hq === false && before.data.is_hq === true) {
    const hqCount = await admin
      .from('da_franchisees')
      .select('id', { count: 'exact', head: true })
      .eq('is_hq', true);
    if (hqCount.error) {
      console.error('hq count check failed', hqCount.error);
      return jsonResponse({ error: 'Failed to verify HQ guard' }, 500);
    }
    if ((hqCount.count ?? 0) <= 1) {
      return jsonResponse(
        { error: 'Cannot demote the only HQ user. Promote another franchisee first.' },
        400,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Email-uniqueness check (if changing).
  // ---------------------------------------------------------------------
  if ('email' in updateFields && updateFields.email !== before.data.email) {
    const dupe = await admin
      .from('da_franchisees')
      .select('id')
      .eq('email', updateFields.email as string)
      .neq('id', body.id)
      .maybeSingle();
    if (dupe.error) {
      console.error('email uniqueness check failed', dupe.error);
      return jsonResponse({ error: 'Failed to check email uniqueness' }, 500);
    }
    if (dupe.data) {
      return jsonResponse(
        { error: `Email ${updateFields.email as string} is already in use` },
        409,
      );
    }
  }

  // Build the changed-fields diff (only entries that actually changed).
  const changedFields: Record<string, unknown> = {};
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};
  for (const [key, newValue] of Object.entries(updateFields)) {
    const oldValue = (before.data as Record<string, unknown>)[key];
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
  // If email changed, update auth.users first so sign-in still works.
  // We do this before the DB update so a failure here doesn't leave
  // db.email and auth.email out of sync.
  // ---------------------------------------------------------------------
  if ('email' in changedFields && before.data.auth_user_id) {
    const authUpdate = await adminUpdateUserEmail(
      supabaseUrl,
      serviceRoleKey,
      before.data.auth_user_id,
      changedFields.email as string,
    );
    if (!authUpdate.ok) {
      return jsonResponse({ error: `Could not update auth email: ${authUpdate.error}` }, 502);
    }
  }

  // ---------------------------------------------------------------------
  // Apply DB update + activity log
  // ---------------------------------------------------------------------
  const updated = await admin
    .from('da_franchisees')
    .update({ ...changedFields, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select('*')
    .single();

  if (updated.error) {
    console.error('franchisee update failed', updated.error);
    if ((updated.error as any).code === '23505') {
      return jsonResponse({ error: 'Number or email already in use' }, 409);
    }
    return jsonResponse({ error: 'Failed to update franchisee' }, 500);
  }

  const franchiseeName = (updated.data as any).name ?? (before.data as any).name ?? 'franchisee';
  const description = summariseChanges(changedFields, beforeSnapshot, franchiseeName);

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'franchisee',
    entity_id: body.id,
    action: 'franchisee_updated',
    metadata: {
      changed_fields: changedFields,
      before: beforeSnapshot,
      after: afterSnapshot,
    },
    description,
  });

  if (activityInsert.error) {
    // The user already saw their edit succeed; log loudly and continue.
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});

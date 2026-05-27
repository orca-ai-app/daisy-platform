// supabase/functions/update-franchisee-self/index.ts
//
// POST { fields: { name?: string, phone?: string | null } } -> updated franchisee row
//
// Franchisee self-service profile update. Constrained counterpart to
// update-franchisee (HQ). Key differences:
//
//  - The target row is resolved from the caller's own JWT sub (auth_user_id),
//    not from a request-body `id`. A franchisee can ONLY update their own row.
//  - Only `name` and `phone` are mutable. Any attempt to pass email, fee_tier,
//    status, is_hq, billing_date, stripe_account_id, stripe_connected,
//    gocardless_mandate_id, number, auth_user_id, or any other field returns 400.
//  - Inserts a da_activities row with actor_type='franchisee', action='profile_updated',
//    and metadata={ changed_fields, before, after }.
//  - Uses service_role client for all DB writes (anon key has no write access).
//  - Returns the updated franchisee row on success.
//  - Returns 4xx for bad input, 401 if not authenticated, 403 if not provisioned,
//    5xx for DB/env issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---------------------------------------------------------------------------
// Whitelist: the ONLY fields a franchisee may change on their own row.
// Any other key in the request body is rejected with 400.
// ---------------------------------------------------------------------------
const ALLOWED_SELF_FIELDS = new Set(['name', 'phone']);

// ---------------------------------------------------------------------------
// Explicitly-blocked fields to produce a clearer error message than the
// generic "Field not editable". These are the fields the caller is most
// likely to attempt if they go off-script.
// ---------------------------------------------------------------------------
const IMMUTABLE_FIELDS = new Set([
  'email',
  'fee_tier',
  'status',
  'is_hq',
  'billing_date',
  'stripe_account_id',
  'stripe_connected',
  'gocardless_mandate_id',
  'number',
  'auth_user_id',
  'id',
  'created_at',
  'updated_at',
  'vat_registered',
  'business_name',
  'notes',
]);

interface RequestBody {
  fields?: Record<string, unknown>;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Decode the `sub` claim from a JWT without verifying the signature.
 *  Supabase validates the JWT before the function runs; we just need the sub. */
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ---------------------------------------------------------------------------
  // Auth: extract caller's auth_user_id from the JWT.
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

  // ---------------------------------------------------------------------------
  // Env: service_role client for all DB writes.
  // ---------------------------------------------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Resolve the caller's own franchisee row via auth_user_id.
  // We deliberately do NOT accept an `id` in the request body — the franchisee
  // can only ever update themselves.
  // ---------------------------------------------------------------------------
  const selfLookup = await admin
    .from('da_franchisees')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (selfLookup.error) {
    console.error('franchisee self-lookup failed', selfLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!selfLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const currentRow = selfLookup.data as Record<string, unknown>;
  const franchiseeId = currentRow.id as string;

  // ---------------------------------------------------------------------------
  // Parse + validate request body.
  // ---------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) {
    return jsonResponse({ error: 'fields is required (object)' }, 400);
  }

  const requestedFields = body.fields as Record<string, unknown>;

  // Check for blocked fields first (friendlier error than generic "not editable").
  for (const key of Object.keys(requestedFields)) {
    if (IMMUTABLE_FIELDS.has(key)) {
      return jsonResponse(
        { error: `Field '${key}' cannot be changed through this endpoint. Contact HQ.` },
        400,
      );
    }
    if (!ALLOWED_SELF_FIELDS.has(key)) {
      return jsonResponse({ error: `Field not editable: ${key}` }, 400);
    }
  }

  if (Object.keys(requestedFields).length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400);
  }

  // ---------------------------------------------------------------------------
  // Per-field type validation.
  // ---------------------------------------------------------------------------
  if (
    'name' in requestedFields &&
    (typeof requestedFields.name !== 'string' || (requestedFields.name as string).trim().length < 2)
  ) {
    return jsonResponse({ error: 'name must be a string of at least 2 characters' }, 400);
  }

  if (
    'phone' in requestedFields &&
    requestedFields.phone !== null &&
    typeof requestedFields.phone !== 'string'
  ) {
    return jsonResponse({ error: 'phone must be a string or null' }, 400);
  }

  // ---------------------------------------------------------------------------
  // Normalise text fields.
  // ---------------------------------------------------------------------------
  const updateFields: Record<string, unknown> = {};

  if ('name' in requestedFields) {
    updateFields.name = (requestedFields.name as string).trim();
  }

  if ('phone' in requestedFields) {
    if (requestedFields.phone === null) {
      updateFields.phone = null;
    } else {
      const trimmed = (requestedFields.phone as string).trim();
      updateFields.phone = trimmed.length === 0 ? null : trimmed;
    }
  }

  // ---------------------------------------------------------------------------
  // Compute diff — skip no-op fields to keep the activity log clean.
  // ---------------------------------------------------------------------------
  const changedFields: Record<string, unknown> = {};
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};

  for (const [key, newValue] of Object.entries(updateFields)) {
    const oldValue = currentRow[key] ?? null;
    const normalisedNew = newValue ?? null;
    if (oldValue !== normalisedNew) {
      changedFields[key] = normalisedNew;
      beforeSnapshot[key] = oldValue;
      afterSnapshot[key] = normalisedNew;
    }
  }

  if (Object.keys(changedFields).length === 0) {
    // No-op: return the current row without touching the activity log.
    return jsonResponse(currentRow, 200);
  }

  // ---------------------------------------------------------------------------
  // Apply DB update.
  // ---------------------------------------------------------------------------
  const updated = await admin
    .from('da_franchisees')
    .update({ ...changedFields, updated_at: new Date().toISOString() })
    .eq('id', franchiseeId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('franchisee self-update failed', updated.error);
    if ((updated.error as any).code === '23505') {
      return jsonResponse({ error: 'Value already in use' }, 409);
    }
    return jsonResponse({ error: 'Failed to update profile' }, 500);
  }

  // ---------------------------------------------------------------------------
  // Audit: insert da_activities row.
  // actor_type = 'franchisee' (not 'hq') — this is a self-service action.
  // ---------------------------------------------------------------------------
  const franchiseeName =
    (updated.data as Record<string, unknown>).name ?? currentRow.name ?? 'franchisee';

  const changedKeys = Object.keys(changedFields);
  const description =
    changedKeys.length === 1
      ? `Franchisee ${franchiseeName as string} updated ${changedKeys[0]}`
      : `Franchisee ${franchiseeName as string} updated profile (${changedKeys.join(', ')})`;

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'franchisee',
    actor_id: franchiseeId,
    entity_type: 'franchisee',
    entity_id: franchiseeId,
    action: 'profile_updated',
    metadata: {
      changed_fields: changedFields,
      before: beforeSnapshot,
      after: afterSnapshot,
    },
    description,
  });

  if (activityInsert.error) {
    // The user's edit already succeeded; log loudly but do not fail the request.
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});

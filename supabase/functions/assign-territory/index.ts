// supabase/functions/assign-territory/index.ts
//
// POST { territory_id: string,
//        franchisee_id: string | null,
//        status?: 'active' | 'vacant' | 'reserved' }
//   -> updated da_territories row
//
// Reference: docs/PRD-technical.md §4.3 (da_territories), §4.15 (da_activities),
// docs/M1-build-plan.md §6 Wave 3 Agent 3A.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. The JWT's `sub` claim is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//    proceed. Non-HQ users get 403.
//  - Uses service_role to UPDATE da_territories.franchisee_id + status.
//  - Inserts a da_activities row describing the change. The action key is
//    one of:
//        territory_assigned    franchisee changed from NULL -> X
//        territory_unassigned  franchisee changed from X -> NULL
//        territory_reassigned  franchisee changed from X -> Y (X != Y, both non-null)
//        territory_status_changed  franchisee unchanged, only status changed
//  - Returns 4xx for bad input, 401/403 for auth failures, 5xx for DB issues.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_STATUSES = new Set(['active', 'vacant', 'reserved']);

interface RequestBody {
  territory_id?: string;
  franchisee_id?: string | null;
  status?: string;
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
  // The Supabase gateway pre-verifies the JWT signature; we just need
  // the `sub` claim to look up the actor.
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

function pickAction(
  beforeFranchiseeId: string | null,
  afterFranchiseeId: string | null,
  beforeStatus: string,
  afterStatus: string,
): string {
  if (beforeFranchiseeId === afterFranchiseeId) {
    if (beforeStatus !== afterStatus) return 'territory_status_changed';
    return 'territory_updated';
  }
  if (!beforeFranchiseeId && afterFranchiseeId) return 'territory_assigned';
  if (beforeFranchiseeId && !afterFranchiseeId) return 'territory_unassigned';
  return 'territory_reassigned';
}

function describe(
  action: string,
  postcodePrefix: string,
  beforeFranchiseeName: string | null,
  afterFranchiseeName: string | null,
  afterStatus: string,
): string {
  switch (action) {
    case 'territory_assigned':
      return `Territory ${postcodePrefix} assigned to ${afterFranchiseeName ?? 'franchisee'}`;
    case 'territory_unassigned':
      return `Territory ${postcodePrefix} unassigned from ${beforeFranchiseeName ?? 'franchisee'}`;
    case 'territory_reassigned':
      return `Territory ${postcodePrefix} reassigned from ${
        beforeFranchiseeName ?? 'franchisee'
      } to ${afterFranchiseeName ?? 'franchisee'}`;
    case 'territory_status_changed':
      return `Territory ${postcodePrefix} status changed to ${afterStatus}`;
    default:
      return `Territory ${postcodePrefix} updated`;
  }
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
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.territory_id || typeof body.territory_id !== 'string' || !isUuid(body.territory_id)) {
    return jsonResponse({ error: 'territory_id is required (uuid)' }, 400);
  }

  if (
    body.franchisee_id !== null &&
    body.franchisee_id !== undefined &&
    (typeof body.franchisee_id !== 'string' || !isUuid(body.franchisee_id))
  ) {
    return jsonResponse({ error: 'franchisee_id must be a uuid or null' }, 400);
  }

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !ALLOWED_STATUSES.has(body.status)) {
      return jsonResponse({ error: 'status must be one of: active, vacant, reserved' }, 400);
    }
  }

  // ---------------------------------------------------------------------
  // Read current territory + before-state for the activity diff
  // ---------------------------------------------------------------------
  const before = await admin
    .from('da_territories')
    .select('id, postcode_prefix, name, status, franchisee_id')
    .eq('id', body.territory_id)
    .maybeSingle();

  if (before.error) {
    console.error('territory lookup failed', before.error);
    return jsonResponse({ error: 'Failed to load territory' }, 500);
  }
  if (!before.data) {
    return jsonResponse({ error: 'Territory not found' }, 404);
  }

  // Resolve franchisee names for the activity description (before + after).
  const franchiseeIdsToLookup = new Set<string>();
  if (before.data.franchisee_id) franchiseeIdsToLookup.add(before.data.franchisee_id);
  if (body.franchisee_id) franchiseeIdsToLookup.add(body.franchisee_id);

  const franchiseeNames = new Map<string, string>();
  if (franchiseeIdsToLookup.size > 0) {
    const lookup = await admin
      .from('da_franchisees')
      .select('id, name')
      .in('id', Array.from(franchiseeIdsToLookup));
    if (lookup.error) {
      console.error('franchisee name lookup failed', lookup.error);
    } else {
      for (const row of lookup.data ?? []) {
        franchiseeNames.set(row.id, row.name);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Build update payload — only include fields the caller actually sent.
  // ---------------------------------------------------------------------
  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // franchisee_id: caller may explicitly set null (unassign) or a uuid.
  // Only treat it as untouched when the property is missing entirely.
  const hasFranchiseeId = Object.prototype.hasOwnProperty.call(body, 'franchisee_id');
  if (hasFranchiseeId) {
    updatePayload.franchisee_id = body.franchisee_id ?? null;
  }
  if (body.status) {
    updatePayload.status = body.status;
  }

  if (Object.keys(updatePayload).length === 1) {
    // Only updated_at would change — nothing meaningful to do.
    return jsonResponse({ error: 'No changes supplied' }, 400);
  }

  const afterFranchiseeId = hasFranchiseeId
    ? (body.franchisee_id ?? null)
    : (before.data.franchisee_id ?? null);
  const afterStatus = body.status ?? before.data.status;

  // No-op short-circuit: if neither franchisee_id nor status actually
  // change, return the row unchanged and skip the activity row.
  if (afterFranchiseeId === before.data.franchisee_id && afterStatus === before.data.status) {
    return jsonResponse(before.data, 200);
  }

  // ---------------------------------------------------------------------
  // Apply update
  // ---------------------------------------------------------------------
  const updated = await admin
    .from('da_territories')
    .update(updatePayload)
    .eq('id', body.territory_id)
    .select('id, postcode_prefix, name, status, franchisee_id, lat, lng, updated_at')
    .single();

  if (updated.error) {
    console.error('territory update failed', updated.error);
    // 23503 = foreign_key_violation (e.g. franchisee_id doesn't exist).
    if ((updated.error as any).code === '23503') {
      return jsonResponse({ error: 'franchisee_id does not exist' }, 400);
    }
    return jsonResponse({ error: 'Failed to update territory' }, 500);
  }

  // ---------------------------------------------------------------------
  // Audit log
  // ---------------------------------------------------------------------
  const action = pickAction(
    before.data.franchisee_id ?? null,
    afterFranchiseeId,
    before.data.status,
    afterStatus,
  );
  const beforeFranchiseeName = before.data.franchisee_id
    ? (franchiseeNames.get(before.data.franchisee_id) ?? null)
    : null;
  const afterFranchiseeName = afterFranchiseeId
    ? (franchiseeNames.get(afterFranchiseeId) ?? null)
    : null;
  const description = describe(
    action,
    before.data.postcode_prefix,
    beforeFranchiseeName,
    afterFranchiseeName,
    afterStatus,
  );

  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'territory',
    entity_id: body.territory_id,
    action,
    metadata: {
      before: {
        franchisee_id: before.data.franchisee_id ?? null,
        franchisee_name: beforeFranchiseeName,
        status: before.data.status,
      },
      after: {
        franchisee_id: afterFranchiseeId,
        franchisee_name: afterFranchiseeName,
        status: afterStatus,
      },
      postcode_prefix: before.data.postcode_prefix,
      territory_name: before.data.name,
    },
    description,
  });

  if (activityInsert.error) {
    // Audit failure must never silently lose the change but the user
    // already saw their edit succeed. Log loudly and continue.
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(updated.data, 200);
});

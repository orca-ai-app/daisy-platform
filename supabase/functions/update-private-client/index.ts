// supabase/functions/update-private-client/index.ts
//
// POST { id, company_name?, contact_name?, contact_email?, contact_phone?, notes? }
//   -> 200 updated row
//   -> 400 bad input
//   -> 401 no / invalid auth
//   -> 403 caller not provisioned, or trying to update another franchisee's client
//   -> 409 UNIQUE(franchisee_id, company_name) collision
//   -> 500 server error
//
// Behaviour:
//   1. Authenticate: JWT sub → da_franchisees.auth_user_id → franchisee row.
//   2. Validate request body (id required; at least one other field required).
//   3. Ownership check: verify the target client's franchisee_id matches the
//      caller's franchisee_id — return 403 if not.
//   4. Compute diff against current row; skip no-op updates.
//   5. UPDATE da_private_clients; stamp updated_at.
//   6. INSERT da_activities (action='private_client_updated').
//   7. Return the updated row with status 200.
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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fields the caller may supply (id + one or more of the rest).
const UPDATABLE_FIELDS = new Set([
  'company_name',
  'contact_name',
  'contact_email',
  'contact_phone',
  'notes',
]);

interface RequestBody {
  id?: unknown;
  [key: string]: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Resolve franchisee from JWT sub
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Parse body
  // -------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) {
    return jsonResponse({ error: 'id must be a valid UUID' }, 400);
  }
  const targetId = body.id;

  // Check for unrecognised keys.
  const updateKeys = Object.keys(body).filter((k) => k !== 'id');
  for (const key of updateKeys) {
    if (!UPDATABLE_FIELDS.has(key)) {
      return jsonResponse({ error: `Field not updatable: ${key}` }, 400);
    }
  }
  if (updateKeys.length === 0) {
    return jsonResponse({ error: 'At least one field must be provided for update' }, 400);
  }

  // -------------------------------------------------------------------------
  // Field-level validation
  // -------------------------------------------------------------------------
  if ('company_name' in body) {
    if (
      typeof body.company_name !== 'string' ||
      (body.company_name as string).trim().length === 0
    ) {
      return jsonResponse({ error: 'company_name must be a non-empty string' }, 400);
    }
  }

  if ('contact_email' in body && body.contact_email !== null) {
    if (typeof body.contact_email !== 'string') {
      return jsonResponse({ error: 'contact_email must be a string or null' }, 400);
    }
    const trimmed = (body.contact_email as string).trim();
    if (trimmed.length > 0 && !EMAIL_REGEX.test(trimmed)) {
      return jsonResponse({ error: 'contact_email must be a valid email address' }, 400);
    }
  }

  for (const field of ['contact_name', 'contact_phone', 'notes'] as const) {
    if (field in body && body[field] !== null && typeof body[field] !== 'string') {
      return jsonResponse({ error: `${field} must be a string or null` }, 400);
    }
  }

  // -------------------------------------------------------------------------
  // Fetch current row (ownership check)
  // -------------------------------------------------------------------------
  const current = await admin
    .from('da_private_clients')
    .select('*')
    .eq('id', targetId)
    .maybeSingle();

  if (current.error) {
    console.error('private_client fetch failed', current.error);
    return jsonResponse({ error: 'Failed to fetch client' }, 500);
  }
  if (!current.data) {
    return jsonResponse({ error: 'Client not found' }, 404);
  }

  const currentRow = current.data as Record<string, unknown>;

  // Ownership gate: franchisee_id on the row must match the caller's id.
  if (currentRow.franchisee_id !== franchisee.id) {
    return jsonResponse({ error: 'You do not own this client' }, 403);
  }

  // -------------------------------------------------------------------------
  // Normalise and compute diff
  // -------------------------------------------------------------------------
  function normalise(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const updatePayload: Record<string, unknown> = {};

  if ('company_name' in body) {
    const v = (body.company_name as string).trim();
    if (v !== currentRow.company_name) updatePayload.company_name = v;
  }
  for (const field of ['contact_name', 'contact_email', 'contact_phone', 'notes'] as const) {
    if (field in body) {
      const v = normalise(body[field]);
      if (v !== (currentRow[field] ?? null)) updatePayload[field] = v;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    // Pure no-op — return current row without touching activities.
    return jsonResponse(currentRow, 200);
  }

  updatePayload.updated_at = new Date().toISOString();

  // -------------------------------------------------------------------------
  // UPDATE da_private_clients
  // -------------------------------------------------------------------------
  const updateResult = await admin
    .from('da_private_clients')
    .update(updatePayload)
    .eq('id', targetId)
    .select('*')
    .single();

  if (updateResult.error || !updateResult.data) {
    console.error('private_client update failed', updateResult.error);
    if ((updateResult.error as any)?.code === '23505') {
      const newName = updatePayload.company_name ?? currentRow.company_name;
      return jsonResponse(
        {
          error: `You already have a client named '${newName as string}'. Use a different name to distinguish them.`,
        },
        409,
      );
    }
    return jsonResponse({ error: 'Failed to update client' }, 500);
  }

  const updatedRow = updateResult.data;

  // -------------------------------------------------------------------------
  // INSERT da_activities
  // -------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'private_client',
      entity_id: targetId,
      action: 'private_client_updated',
      metadata: {
        changed_fields: Object.keys(updatePayload).filter((k) => k !== 'updated_at'),
        company_name: (updatedRow as any).company_name,
      },
      description: `Private client '${(updatedRow as any).company_name as string}' updated`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity log insert failed', r.error);
    });

  return jsonResponse(updatedRow, 200);
});

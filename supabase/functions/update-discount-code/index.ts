// supabase/functions/update-discount-code/index.ts
//
// POST {
//   id:           string   — UUID of the da_discount_codes row to update
//   code?:        string   — uppercased; re-checked for global uniqueness
//   type?:        'percentage' | 'fixed'
//   value?:       integer  — 0-100 for percentage; pence >= 0 for fixed
//   max_uses?:    number | null
//   valid_from?:  string | null  — ISO timestamp
//   valid_until?: string | null  — ISO timestamp
//   is_active?:   boolean
// }
// -> updated da_discount_codes row (200)
//
// Auth: Bearer JWT required. Resolved to a da_franchisees row. The caller may
//       only update codes where franchisee_id = their own id (403 otherwise).
//       `uses_count` and `franchisee_id` cannot be changed via this surface.
//
// Errors:
//   400 — validation failure or attempt to edit uses_count / franchisee_id
//   401 — no / invalid JWT
//   403 — caller not provisioned, or code belongs to another franchisee
//   404 — code id not found
//   409 — updated code string already exists globally
//   500 — DB or env error

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

// ---------------------------------------------------------------------------
// Explicitly blocked fields — reject with a clear message if the caller tries
// to change them.
// ---------------------------------------------------------------------------
const BLOCKED_FIELDS = new Set(['uses_count', 'franchisee_id', 'id', 'created_at']);

const CODE_REGEX = /^[A-Z0-9_-]{1,50}$/;
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface RawBody {
  id?: unknown;
  code?: unknown;
  type?: unknown;
  value?: unknown;
  max_uses?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
  is_active?: unknown;
  [key: string]: unknown;
}

interface ValidatedInput {
  id: string;
  code?: string;
  type?: 'percentage' | 'fixed';
  value?: number;
  max_uses?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
}

function validate(
  body: RawBody,
): { ok: true; value: ValidatedInput } | { ok: false; error: string; status?: number } {
  // Reject blocked fields immediately.
  for (const key of Object.keys(body)) {
    if (BLOCKED_FIELDS.has(key)) {
      return {
        ok: false,
        error: `Field '${key}' cannot be changed through this endpoint.`,
        status: 400,
      };
    }
  }

  // id
  if (typeof body.id !== 'string' || body.id.trim().length === 0) {
    return { ok: false, error: 'id is required' };
  }
  const id = body.id.trim();

  const out: ValidatedInput = { id };

  // code (optional)
  if (body.code !== undefined) {
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      return { ok: false, error: 'code must be a non-empty string' };
    }
    const code = body.code.trim().toUpperCase();
    if (!CODE_REGEX.test(code)) {
      return {
        ok: false,
        error: 'code must be 1-50 characters; letters, digits, hyphens and underscores only',
      };
    }
    out.code = code;
  }

  // type (optional)
  if (body.type !== undefined) {
    if (body.type !== 'percentage' && body.type !== 'fixed') {
      return { ok: false, error: "type must be 'percentage' or 'fixed'" };
    }
    out.type = body.type as 'percentage' | 'fixed';
  }

  // value (optional — only valid alongside or with existing type context)
  if (body.value !== undefined) {
    if (typeof body.value !== 'number' || !Number.isInteger(body.value)) {
      return { ok: false, error: 'value must be an integer' };
    }
    const v = body.value as number;
    if (v < 0) {
      return { ok: false, error: 'value must be 0 or greater' };
    }
    // If type is also being changed, validate against new type; otherwise
    // server resolves against existing type. The DB CHECK enforces it too.
    const resolvedType = out.type;
    if (resolvedType === 'percentage' && v > 100) {
      return { ok: false, error: 'value must be between 0 and 100 for percentage type' };
    }
    out.value = v;
  }

  // max_uses (optional)
  if (body.max_uses !== undefined) {
    if (body.max_uses === null) {
      out.max_uses = null;
    } else if (
      typeof body.max_uses !== 'number' ||
      !Number.isInteger(body.max_uses) ||
      (body.max_uses as number) < 1
    ) {
      return { ok: false, error: 'max_uses must be a positive integer or null' };
    } else {
      out.max_uses = body.max_uses as number;
    }
  }

  // valid_from (optional)
  if (body.valid_from !== undefined) {
    if (body.valid_from === null) {
      out.valid_from = null;
    } else if (typeof body.valid_from !== 'string' || !ISO_REGEX.test(body.valid_from)) {
      return { ok: false, error: 'valid_from must be an ISO timestamp string or null' };
    } else {
      out.valid_from = body.valid_from;
    }
  }

  // valid_until (optional)
  if (body.valid_until !== undefined) {
    if (body.valid_until === null) {
      out.valid_until = null;
    } else if (typeof body.valid_until !== 'string' || !ISO_REGEX.test(body.valid_until)) {
      return { ok: false, error: 'valid_until must be an ISO timestamp string or null' };
    } else {
      out.valid_until = body.valid_until;
    }
  }

  // is_active (optional)
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') {
      return { ok: false, error: 'is_active must be a boolean' };
    }
    out.is_active = body.is_active;
  }

  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

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
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  // --- Env -----------------------------------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // --- Resolve caller's franchisee row ------------------------------------
  const callerLookup = await admin
    .from('da_franchisees')
    .select('id, name')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (callerLookup.error) {
    console.error('franchisee lookup failed', callerLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!callerLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchiseeId = (callerLookup.data as any).id as string;
  const franchiseeName = (callerLookup.data as any).name as string;

  // --- Parse body ----------------------------------------------------------
  let body: RawBody;
  try {
    body = (await req.json()) as RawBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validated = validate(body);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, validated.status ?? 400);
  }
  const input = validated.value;

  // --- Fetch the existing row (ownership check) ----------------------------
  const existing = await admin
    .from('da_discount_codes')
    .select('*')
    .eq('id', input.id)
    .maybeSingle();

  if (existing.error) {
    console.error('discount code fetch failed', existing.error);
    return jsonResponse({ error: 'Failed to fetch discount code' }, 500);
  }
  if (!existing.data) {
    return jsonResponse({ error: 'Discount code not found' }, 404);
  }

  const currentRow = existing.data as Record<string, unknown>;

  // Ownership check: the franchisee may only update their OWN codes.
  if (currentRow.franchisee_id !== franchiseeId) {
    return jsonResponse({ error: 'You do not have permission to edit this discount code' }, 403);
  }

  // --- Global code uniqueness check (only if code is being changed) --------
  if (input.code !== undefined && input.code !== (currentRow.code as string)) {
    const collision = await admin
      .from('da_discount_codes')
      .select('id')
      .eq('code', input.code)
      .maybeSingle();

    if (collision.error) {
      console.error('uniqueness check failed', collision.error);
      return jsonResponse({ error: 'Failed to check code uniqueness' }, 500);
    }
    if (collision.data) {
      return jsonResponse(
        { error: `Code '${input.code}' is already in use. Choose a different code.` },
        409,
      );
    }
  }

  // --- Cross-validate type+value when only one side is being updated -------
  // If caller updates value but not type, resolve against existing type.
  if (input.value !== undefined && input.type === undefined) {
    const existingType = currentRow.type as 'percentage' | 'fixed';
    if (existingType === 'percentage' && input.value > 100) {
      return jsonResponse({ error: 'value must be between 0 and 100 for percentage type' }, 400);
    }
  }

  // --- Build update payload (only fields present in the request) -----------
  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.code !== undefined) updateFields.code = input.code;
  if (input.type !== undefined) updateFields.type = input.type;
  if (input.value !== undefined) updateFields.value = input.value;
  if ('max_uses' in input) updateFields.max_uses = input.max_uses ?? null;
  if ('valid_from' in input) updateFields.valid_from = input.valid_from ?? null;
  if ('valid_until' in input) updateFields.valid_until = input.valid_until ?? null;
  if (input.is_active !== undefined) updateFields.is_active = input.is_active;

  // --- Apply DB update -----------------------------------------------------
  const updated = await admin
    .from('da_discount_codes')
    .update(updateFields)
    .eq('id', input.id)
    .select('*')
    .single();

  if (updated.error || !updated.data) {
    console.error('discount code update failed', updated.error);
    if ((updated.error as any)?.code === '23505') {
      return jsonResponse({ error: `Code is already in use. Choose a different code.` }, 409);
    }
    if ((updated.error as any)?.code === '23514') {
      return jsonResponse({ error: 'Value is out of range for the selected type' }, 400);
    }
    return jsonResponse({ error: 'Failed to update discount code' }, 500);
  }

  const updatedCode = updated.data;

  // --- Activity log --------------------------------------------------------
  // Compute changed fields for the metadata snapshot.
  const changedFields: Record<string, unknown> = {};
  const beforeSnapshot: Record<string, unknown> = {};

  for (const [key, newVal] of Object.entries(updateFields)) {
    if (key === 'updated_at') continue;
    const oldVal = currentRow[key] ?? null;
    if (oldVal !== (newVal ?? null)) {
      changedFields[key] = newVal ?? null;
      beforeSnapshot[key] = oldVal;
    }
  }

  if (Object.keys(changedFields).length > 0) {
    const activityInsert = await admin.from('da_activities').insert({
      actor_type: 'franchisee',
      actor_id: franchiseeId,
      entity_type: 'discount_code',
      entity_id: input.id,
      action: 'discount_code_updated',
      metadata: {
        changed_fields: changedFields,
        before: beforeSnapshot,
        after: changedFields,
      },
      description: `Franchisee ${franchiseeName} updated discount code ${(updatedCode as any).code}`,
    });

    if (activityInsert.error) {
      console.error('activity log insert failed', activityInsert.error);
      // The update succeeded; do not fail the request.
    }
  }

  return jsonResponse(updatedCode, 200);
});

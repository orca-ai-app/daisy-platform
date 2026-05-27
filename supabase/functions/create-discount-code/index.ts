// supabase/functions/create-discount-code/index.ts
//
// POST {
//   code:        string   — uppercased, globally unique across da_discount_codes
//   type:        'percentage' | 'fixed'
//   value:       integer  — 0-100 for percentage; pence for fixed (>= 0)
//   max_uses?:   number | null
//   valid_from?: string | null  — ISO timestamp
//   valid_until?: string | null — ISO timestamp
//   is_active?:  boolean (default true)
// }
// -> inserted da_discount_codes row (201)
//
// Auth: Bearer JWT required. Resolved to a da_franchisees row via
//       auth_user_id. The caller must be a provisioned franchisee (not
//       necessarily is_hq). `franchisee_id` is stamped server-side; the
//       client cannot supply it and cannot create network-wide (NULL) codes.
//
// Errors:
//   400 — validation failure (missing/wrong type fields, value out of range)
//   401 — no / invalid JWT
//   403 — JWT sub not matched to a da_franchisees row
//   409 — code string already exists globally (case-insensitive via UPPER())
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
// Validation
// ---------------------------------------------------------------------------

interface RawBody {
  code?: unknown;
  type?: unknown;
  value?: unknown;
  max_uses?: unknown;
  valid_from?: unknown;
  valid_until?: unknown;
  is_active?: unknown;
}

interface ValidatedInput {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  max_uses: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
}

const CODE_REGEX = /^[A-Z0-9_-]{1,50}$/;
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function validate(
  body: RawBody,
): { ok: true; value: ValidatedInput } | { ok: false; error: string } {
  // code
  if (typeof body.code !== 'string' || body.code.trim().length === 0) {
    return { ok: false, error: 'code is required' };
  }
  const code = body.code.trim().toUpperCase();
  if (!CODE_REGEX.test(code)) {
    return {
      ok: false,
      error: 'code must be 1-50 characters; letters, digits, hyphens and underscores only',
    };
  }

  // type
  if (body.type !== 'percentage' && body.type !== 'fixed') {
    return { ok: false, error: "type must be 'percentage' or 'fixed'" };
  }
  const type = body.type as 'percentage' | 'fixed';

  // value
  if (typeof body.value !== 'number' || !Number.isInteger(body.value)) {
    return { ok: false, error: 'value must be an integer' };
  }
  const value = body.value as number;
  if (value < 0) {
    return { ok: false, error: 'value must be 0 or greater' };
  }
  if (type === 'percentage' && (value < 0 || value > 100)) {
    return { ok: false, error: 'value must be between 0 and 100 for percentage type' };
  }

  // max_uses
  let maxUses: number | null = null;
  if (body.max_uses !== undefined && body.max_uses !== null) {
    if (
      typeof body.max_uses !== 'number' ||
      !Number.isInteger(body.max_uses) ||
      body.max_uses < 1
    ) {
      return { ok: false, error: 'max_uses must be a positive integer or null' };
    }
    maxUses = body.max_uses as number;
  }

  // valid_from
  let validFrom: string | null = null;
  if (body.valid_from !== undefined && body.valid_from !== null) {
    if (typeof body.valid_from !== 'string' || !ISO_REGEX.test(body.valid_from)) {
      return { ok: false, error: 'valid_from must be an ISO timestamp string or null' };
    }
    validFrom = body.valid_from;
  }

  // valid_until
  let validUntil: string | null = null;
  if (body.valid_until !== undefined && body.valid_until !== null) {
    if (typeof body.valid_until !== 'string' || !ISO_REGEX.test(body.valid_until)) {
      return { ok: false, error: 'valid_until must be an ISO timestamp string or null' };
    }
    validUntil = body.valid_until;
  }

  // is_active
  const isActive = body.is_active !== false; // default true

  return {
    ok: true,
    value: {
      code,
      type,
      value,
      max_uses: maxUses,
      valid_from: validFrom,
      valid_until: validUntil,
      is_active: isActive,
    },
  };
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
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // --- Global code uniqueness check (case-insensitive via UPPER) -----------
  // The DB column has UPPER(code) unique index enforcing this at the DB layer
  // too, but we check here first to produce a friendly 409 message rather
  // than a raw constraint error.
  const collision = await admin
    .from('da_discount_codes')
    .select('id')
    .eq('code', input.code) // code is already uppercased
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

  // --- Insert --------------------------------------------------------------
  const insertPayload = {
    franchisee_id: franchiseeId, // never NULL from this surface
    code: input.code,
    type: input.type,
    value: input.value,
    max_uses: input.max_uses,
    valid_from: input.valid_from,
    valid_until: input.valid_until,
    is_active: input.is_active,
    uses_count: 0,
  };

  const inserted = await admin.from('da_discount_codes').insert(insertPayload).select('*').single();

  if (inserted.error || !inserted.data) {
    console.error('discount code insert failed', inserted.error);
    // 23505 = unique_violation (race between the check above and insert)
    if ((inserted.error as any)?.code === '23505') {
      return jsonResponse(
        { error: `Code '${input.code}' is already in use. Choose a different code.` },
        409,
      );
    }
    // 23514 = check_violation (value out of range for type, DB enforces)
    if ((inserted.error as any)?.code === '23514') {
      return jsonResponse({ error: 'Value is out of range for the selected type' }, 400);
    }
    return jsonResponse({ error: 'Failed to create discount code' }, 500);
  }

  const newCode = inserted.data;

  // --- Activity log --------------------------------------------------------
  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'franchisee',
    actor_id: franchiseeId,
    entity_type: 'discount_code',
    entity_id: (newCode as any).id,
    action: 'discount_code_created',
    metadata: {
      code: input.code,
      type: input.type,
      value: input.value,
      max_uses: input.max_uses,
      is_active: input.is_active,
    },
    description: `Franchisee ${franchiseeName} created discount code ${input.code}`,
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
    // The code was created successfully; do not fail the request.
  }

  return jsonResponse(newCode, 201);
});

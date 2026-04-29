// supabase/functions/create-franchisee/index.ts
//
// POST { number, name, email, fee_tier, billing_date, phone?, notes?, is_hq? }
//   -> { franchisee: <da_franchisees row>, magic_link: <url>, auth_user_id: <uuid> }
//
// Reference: docs/PRD-technical.md §4.2 (da_franchisees), §3.2 (auth flow),
// §4.15 (da_activities), docs/M1-build-plan.md §6 Wave 4 Agent 4A.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. Caller's JWT `sub` is matched
//    against da_franchisees.auth_user_id; only rows with `is_hq = TRUE` may
//    proceed. Non-HQ users get 403.
//  - Validates the input body against an explicit field whitelist + types.
//    Rejects with 400 + descriptive error.
//  - Uses service_role to:
//      a. Verify the supplied number/email aren't already in da_franchisees
//         (409 if so).
//      b. Create a Supabase auth.users row via the admin REST API
//         (`POST /auth/v1/admin/users`) with `email_confirm: true` so the
//         user can sign in via magic link without further email confirmation.
//      c. INSERT da_franchisees with auth_user_id linked to the new user.
//      d. Generate a magic-link sign-in URL via the admin generate_link
//         endpoint (`POST /auth/v1/admin/generate_link`, type=magiclink) so
//         HQ can send it manually (Postmark isn't wired until M3, so we
//         surface the link in the response).
//      e. INSERT a da_activities row narrating the onboarding.
//  - Rollback semantics:
//      - If the franchisees INSERT fails after the auth user is created,
//        the auth user is deleted (best-effort) before responding.
//      - If anything fails after the franchisees INSERT, the row is kept
//        and a system activity row is written so the failure is auditable.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_FEE_TIERS = new Set([100, 120]);

interface CreateRequestBody {
  number?: unknown;
  name?: unknown;
  email?: unknown;
  fee_tier?: unknown;
  billing_date?: unknown;
  phone?: unknown;
  notes?: unknown;
  is_hq?: unknown;
}

interface ErrorResponse {
  error: string;
}

const NUMBER_REGEX = /^\d{4}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_REDIRECT = 'https://daisy-crm-platform.netlify.app/auth/callback';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function decodeJwtSub(jwt: string): string | null {
  // The Supabase gateway validates the JWT signature before our code runs.
  // We just need the `sub` claim to look up the actor.
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

interface ValidatedInput {
  number: string;
  name: string;
  email: string;
  fee_tier: number;
  billing_date: number;
  phone: string | null;
  notes: string | null;
  is_hq: boolean;
}

function validate(
  body: CreateRequestBody,
): { ok: true; value: ValidatedInput } | { ok: false; error: string } {
  if (typeof body.number !== 'string' || !NUMBER_REGEX.test(body.number)) {
    return { ok: false, error: 'number must be a 4-digit zero-padded string (e.g. "0042")' };
  }
  if (typeof body.name !== 'string' || body.name.trim().length < 2) {
    return { ok: false, error: 'name must be a string of at least 2 characters' };
  }
  if (typeof body.email !== 'string' || !EMAIL_REGEX.test(body.email)) {
    return { ok: false, error: 'email must be a valid email address' };
  }
  if (
    typeof body.fee_tier !== 'number' ||
    !Number.isInteger(body.fee_tier) ||
    !ALLOWED_FEE_TIERS.has(body.fee_tier)
  ) {
    return { ok: false, error: 'fee_tier must be 100 or 120' };
  }
  if (
    typeof body.billing_date !== 'number' ||
    !Number.isInteger(body.billing_date) ||
    body.billing_date < 1 ||
    body.billing_date > 28
  ) {
    return { ok: false, error: 'billing_date must be an integer between 1 and 28' };
  }
  if (
    body.phone !== undefined &&
    body.phone !== null &&
    (typeof body.phone !== 'string' || body.phone.trim().length === 0)
  ) {
    return { ok: false, error: 'phone must be a non-empty string or null' };
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return { ok: false, error: 'notes must be a string or null' };
  }
  if (body.is_hq !== undefined && typeof body.is_hq !== 'boolean') {
    return { ok: false, error: 'is_hq must be a boolean' };
  }

  return {
    ok: true,
    value: {
      number: body.number,
      name: (body.name as string).trim(),
      email: (body.email as string).trim().toLowerCase(),
      fee_tier: body.fee_tier as number,
      billing_date: body.billing_date as number,
      phone:
        typeof body.phone === 'string' && body.phone.trim().length > 0
          ? (body.phone as string).trim()
          : null,
      notes:
        typeof body.notes === 'string' && body.notes.trim().length > 0
          ? (body.notes as string).trim()
          : null,
      is_hq: body.is_hq === true,
    },
  };
}

async function adminCreateUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  const url = `${supabaseUrl}/auth/v1/admin/users`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
    }),
  });

  if (!response.ok) {
    let message = `auth admin create failed (${response.status})`;
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

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    return { ok: false, status: 500, error: 'auth admin create returned no user id' };
  }
  return { ok: true, userId: data.id };
}

async function adminDeleteUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
  } catch (err) {
    console.error('auth admin delete (rollback) failed', err);
  }
}

async function adminGenerateMagicLink(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
  redirectTo: string,
): Promise<string | null> {
  // type=magiclink for an existing (already-confirmed) user.
  // PRD §3.2 — magic-link sign-in is the canonical M1 onboarding flow.
  const url = `${supabaseUrl}/auth/v1/admin/generate_link`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      type: 'magiclink',
      email,
      options: { redirect_to: redirectTo },
    }),
  });

  if (!response.ok) {
    console.error('generate_link failed', response.status, await response.text().catch(() => ''));
    return null;
  }

  // Newer Supabase returns `properties.action_link`; older may return `action_link` at the top.
  const body = (await response.json()) as {
    action_link?: string;
    properties?: { action_link?: string };
  };
  return body.properties?.action_link ?? body.action_link ?? null;
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
  let body: CreateRequestBody;
  try {
    body = (await req.json()) as CreateRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validated = validate(body);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // ---------------------------------------------------------------------
  // Uniqueness check (number + email)
  // ---------------------------------------------------------------------
  const dupes = await admin
    .from('da_franchisees')
    .select('id, number, email')
    .or(`number.eq.${input.number},email.eq.${input.email}`);

  if (dupes.error) {
    console.error('uniqueness check failed', dupes.error);
    return jsonResponse({ error: 'Failed to check existing franchisees' }, 500);
  }

  for (const row of dupes.data ?? []) {
    if (row.number === input.number) {
      return jsonResponse({ error: `Number ${input.number} is already in use` }, 409);
    }
    if ((row.email ?? '').toLowerCase() === input.email) {
      return jsonResponse({ error: `Email ${input.email} is already in use` }, 409);
    }
  }

  // ---------------------------------------------------------------------
  // Create auth user (admin API)
  // ---------------------------------------------------------------------
  const created = await adminCreateUser(supabaseUrl, serviceRoleKey, input.email);
  if (!created.ok) {
    // Translate the most common admin-API failure (existing user) into 409.
    const isDuplicate =
      /already|registered|exists|duplicate/i.test(created.error) || created.status === 422;
    return jsonResponse(
      { error: `Auth user creation failed: ${created.error}` },
      isDuplicate ? 409 : 502,
    );
  }
  const newAuthUserId = created.userId;

  // ---------------------------------------------------------------------
  // INSERT da_franchisees row
  // ---------------------------------------------------------------------
  const insertPayload: Record<string, unknown> = {
    number: input.number,
    name: input.name,
    email: input.email,
    phone: input.phone,
    fee_tier: input.fee_tier,
    billing_date: input.billing_date,
    notes: input.notes,
    is_hq: input.is_hq,
    auth_user_id: newAuthUserId,
    // status defaults to 'active' from the schema.
  };

  const inserted = await admin.from('da_franchisees').insert(insertPayload).select('*').single();

  if (inserted.error || !inserted.data) {
    console.error('franchisee insert failed', inserted.error);
    // Roll the auth user back so we don't leave an orphan.
    await adminDeleteUser(supabaseUrl, serviceRoleKey, newAuthUserId);
    // 23505 = unique_violation (race with another HQ create call).
    if ((inserted.error as any)?.code === '23505') {
      return jsonResponse({ error: 'Franchisee number or email already in use' }, 409);
    }
    return jsonResponse({ error: 'Failed to create franchisee' }, 500);
  }

  const franchiseeRow = inserted.data;

  // ---------------------------------------------------------------------
  // Generate magic link (best-effort; failure logs but doesn't roll back)
  // ---------------------------------------------------------------------
  const magicLink = await adminGenerateMagicLink(
    supabaseUrl,
    serviceRoleKey,
    input.email,
    DEFAULT_REDIRECT,
  );

  if (!magicLink) {
    // We can't roll back the auth user + franchisee at this point because
    // the row is real. Log a system activity so the failure is visible to HQ.
    await admin.from('da_activities').insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'franchisee',
      entity_id: (franchiseeRow as any).id,
      action: 'franchisee_magic_link_failed',
      metadata: { email: input.email },
      description: `Could not generate magic link for ${input.email} - HQ should send a password-reset link manually`,
    });
  }

  // ---------------------------------------------------------------------
  // Activity log
  // ---------------------------------------------------------------------
  const description = `Franchisee ${input.number} (${input.name}) onboarded`;
  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'hq',
    actor_id: actor.data.id,
    entity_type: 'franchisee',
    entity_id: (franchiseeRow as any).id,
    action: 'franchisee_created',
    metadata: {
      number: input.number,
      name: input.name,
      email: input.email,
      fee_tier: input.fee_tier,
      billing_date: input.billing_date,
      is_hq: input.is_hq,
    },
    description,
  });

  if (activityInsert.error) {
    // The user already saw their create succeed; log loudly and continue.
    console.error('activity log insert failed', activityInsert.error);
  }

  return jsonResponse(
    {
      franchisee: franchiseeRow,
      auth_user_id: newAuthUserId,
      magic_link: magicLink,
    },
    201,
  );
});

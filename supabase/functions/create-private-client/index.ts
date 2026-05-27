// supabase/functions/create-private-client/index.ts
//
// POST { company_name, contact_name?, contact_email?, contact_phone?, notes? }
//   -> 201 { id, created_at, updated_at, franchisee_id, company_name,
//             contact_name, contact_email, contact_phone, notes }
//   -> 400 bad input
//   -> 401 no / invalid auth
//   -> 403 caller not provisioned as a franchisee
//   -> 409 UNIQUE(franchisee_id, company_name) collision
//   -> 500 server error
//
// Behaviour:
//   1. Authenticate: JWT sub → da_franchisees.auth_user_id → franchisee row.
//   2. Validate request body (company_name required; rest optional strings).
//   3. INSERT da_private_clients with franchisee_id stamped from the caller's
//      session (never trusted from the request body).
//   4. INSERT da_activities (actor_type='franchisee', action='private_client_created').
//   5. Return the inserted row with status 201.
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RequestBody {
  company_name?: unknown;
  contact_name?: unknown;
  contact_email?: unknown;
  contact_phone?: unknown;
  notes?: unknown;
}

interface ValidatedInput {
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
}

function nullableString(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string')
    return { ok: false, error: `${fieldName} must be a string or null` };
  const trimmed = value.trim();
  return { ok: true, value: trimmed.length > 0 ? trimmed : null };
}

function validateBody(
  body: RequestBody,
): { ok: true; value: ValidatedInput } | { ok: false; error: string } {
  if (typeof body.company_name !== 'string' || body.company_name.trim().length === 0) {
    return { ok: false, error: 'company_name is required' };
  }

  const contactName = nullableString(body.contact_name, 'contact_name');
  if (!contactName.ok) return { ok: false, error: contactName.error };

  const contactEmail = nullableString(body.contact_email, 'contact_email');
  if (!contactEmail.ok) return { ok: false, error: contactEmail.error };
  if (contactEmail.value !== null && !EMAIL_REGEX.test(contactEmail.value)) {
    return { ok: false, error: 'contact_email must be a valid email address' };
  }

  const contactPhone = nullableString(body.contact_phone, 'contact_phone');
  if (!contactPhone.ok) return { ok: false, error: contactPhone.error };

  const notes = nullableString(body.notes, 'notes');
  if (!notes.ok) return { ok: false, error: notes.error };

  return {
    ok: true,
    value: {
      company_name: body.company_name.trim(),
      contact_name: contactName.value,
      contact_email: contactEmail.value,
      contact_phone: contactPhone.value,
      notes: notes.value,
    },
  };
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
  // Parse + validate body
  // -------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const validated = validateBody(body);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error }, 400);
  }
  const input = validated.value;

  // -------------------------------------------------------------------------
  // INSERT da_private_clients
  // franchisee_id is ALWAYS taken from the session — never from the request body.
  // -------------------------------------------------------------------------
  const insertResult = await admin
    .from('da_private_clients')
    .insert({
      franchisee_id: franchisee.id,
      company_name: input.company_name,
      contact_name: input.contact_name,
      contact_email: input.contact_email,
      contact_phone: input.contact_phone,
      notes: input.notes,
    })
    .select('*')
    .single();

  if (insertResult.error || !insertResult.data) {
    console.error('private_client insert failed', insertResult.error);
    // 23505 = unique_violation: UNIQUE(franchisee_id, company_name)
    if ((insertResult.error as any)?.code === '23505') {
      return jsonResponse(
        {
          error: `You already have a client named '${input.company_name}'. Use a different name to distinguish them.`,
        },
        409,
      );
    }
    return jsonResponse({ error: 'Failed to create client' }, 500);
  }

  const clientRow = insertResult.data;

  // -------------------------------------------------------------------------
  // INSERT da_activities
  // -------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'private_client',
      entity_id: (clientRow as any).id,
      action: 'private_client_created',
      metadata: {
        company_name: input.company_name,
        contact_name: input.contact_name,
        contact_email: input.contact_email,
      },
      description: `Private client '${input.company_name}' created`,
    })
    .catch((err: unknown) => {
      console.error('activity log insert failed', err);
    });

  return jsonResponse(clientRow, 201);
});

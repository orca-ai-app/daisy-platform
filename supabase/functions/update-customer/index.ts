// supabase/functions/update-customer/index.ts
//
// POST { customer_id, first_name?, last_name?, phone?, email? } -> 200 updated customer row
//
// Edits a customer's contact details (NTH-13). da_customers is keyed by
// email, so an email change to an address already used by ANOTHER customer
// row is rejected with 409 — merging duplicate customers is not supported
// in this version.
//
// Behaviour:
//  1. Auth: JWT sub → da_franchisees.auth_user_id → caller row (+ is_hq).
//  2. Load the customer row.
//  3. Ownership: the caller must have at least one booking with this
//     customer (HQ may edit any customer) → 403 if not.
//  4. Validate supplied fields; email format-checked and lowercased; if
//     another da_customers row already has the new email → 409.
//  5. UPDATE da_customers with the supplied fields; stamp updated_at.
//  6. INSERT da_activities (action='customer_updated', metadata lists the
//     changed FIELD NAMES only — never old/new email values).
//  7. Return updated row.
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
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

interface RequestBody {
  customer_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  phone?: unknown;
  email?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ---------------------------------------------------------------------------
  // Auth
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Resolve franchisee from JWT sub
  // ---------------------------------------------------------------------------
  const franchiseeResult = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (franchiseeResult.error) {
    console.error('franchisee lookup failed', franchiseeResult.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!franchiseeResult.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const caller = franchiseeResult.data as { id: string; name: string; is_hq: boolean };

  // ---------------------------------------------------------------------------
  // Parse + validate body
  // ---------------------------------------------------------------------------
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!isUuid(body.customer_id)) {
    return jsonResponse({ error: 'customer_id is required (uuid)' }, 400);
  }
  const customerId = body.customer_id;

  const updatePayload: Record<string, unknown> = {};
  const changedFields: string[] = [];

  if (body.first_name !== undefined) {
    if (typeof body.first_name !== 'string' || body.first_name.trim().length === 0) {
      return jsonResponse({ error: 'first_name must be a non-empty string' }, 400);
    }
    updatePayload.first_name = body.first_name.trim();
    changedFields.push('first_name');
  }

  if (body.last_name !== undefined) {
    if (typeof body.last_name !== 'string' || body.last_name.trim().length === 0) {
      return jsonResponse({ error: 'last_name must be a non-empty string' }, 400);
    }
    updatePayload.last_name = body.last_name.trim();
    changedFields.push('last_name');
  }

  if (body.phone !== undefined) {
    if (body.phone !== null && typeof body.phone !== 'string') {
      return jsonResponse({ error: 'phone must be a string or null' }, 400);
    }
    const trimmed = typeof body.phone === 'string' ? body.phone.trim() : '';
    updatePayload.phone = trimmed.length > 0 ? trimmed : null;
    changedFields.push('phone');
  }

  let newEmail: string | null = null;
  if (body.email !== undefined) {
    if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email.trim())) {
      return jsonResponse({ error: 'email must be a valid email address' }, 400);
    }
    newEmail = body.email.trim().toLowerCase();
    updatePayload.email = newEmail;
    changedFields.push('email');
  }

  if (changedFields.length === 0) {
    return jsonResponse(
      { error: 'At least one of first_name, last_name, phone, email is required' },
      400,
    );
  }

  // ---------------------------------------------------------------------------
  // Load the customer row
  // ---------------------------------------------------------------------------
  const customerResult = await admin
    .from('da_customers')
    .select('id, email')
    .eq('id', customerId)
    .maybeSingle();

  if (customerResult.error) {
    console.error('customer lookup failed', customerResult.error);
    return jsonResponse({ error: 'Failed to load customer' }, 500);
  }
  if (!customerResult.data) {
    return jsonResponse({ error: 'Customer not found' }, 404);
  }
  const customer = customerResult.data as { id: string; email: string };

  // ---------------------------------------------------------------------------
  // Ownership: the caller must have at least one booking with this customer
  // (HQ may edit any customer)
  // ---------------------------------------------------------------------------
  if (!caller.is_hq) {
    const bookingCheck = await admin
      .from('da_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('franchisee_id', caller.id);

    if (bookingCheck.error) {
      console.error('booking ownership check failed', bookingCheck.error);
      return jsonResponse({ error: 'Failed to verify customer ownership' }, 500);
    }
    if ((bookingCheck.count ?? 0) === 0) {
      return jsonResponse({ error: 'You do not have any bookings with this customer' }, 403);
    }
  }

  // ---------------------------------------------------------------------------
  // Email uniqueness: da_customers is keyed by email. If ANOTHER row already
  // has the new address, reject — merging is not supported in this version.
  // ---------------------------------------------------------------------------
  if (newEmail !== null && newEmail !== customer.email) {
    const duplicateCheck = await admin
      .from('da_customers')
      .select('id')
      .eq('email', newEmail)
      .neq('id', customerId)
      .maybeSingle();

    if (duplicateCheck.error) {
      console.error('duplicate email check failed', duplicateCheck.error);
      return jsonResponse({ error: 'Failed to check email availability' }, 500);
    }
    if (duplicateCheck.data) {
      return jsonResponse(
        {
          error:
            'That email address is already in use by another customer record. Merging customer records is not supported yet — use a different address or contact HQ.',
        },
        409,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE da_customers
  // ---------------------------------------------------------------------------
  updatePayload.updated_at = new Date().toISOString();

  const updated = await admin
    .from('da_customers')
    .update(updatePayload)
    .eq('id', customerId)
    .select('*')
    .single();

  if (updated.error) {
    console.error('customer update failed', updated.error);
    return jsonResponse({ error: 'Failed to update customer' }, 500);
  }

  // ---------------------------------------------------------------------------
  // INSERT da_activities — changed FIELD NAMES only, never email values
  // ---------------------------------------------------------------------------
  await admin
    .from('da_activities')
    .insert({
      actor_type: caller.is_hq ? 'hq' : 'franchisee',
      actor_id: caller.id,
      entity_type: 'customer',
      entity_id: customerId,
      action: 'customer_updated',
      metadata: {
        changed_fields: changedFields,
      },
      description: `Customer details updated (${changedFields.join(', ')}) by ${caller.name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity log insert failed', r.error);
    });

  return jsonResponse(updated.data, 200);
});

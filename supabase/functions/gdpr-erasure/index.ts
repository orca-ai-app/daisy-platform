// supabase/functions/gdpr-erasure/index.ts
//
// HQ-ONLY (JWT) — UK GDPR right to erasure. PRD §12.2.
//
// POST { email } -> 200 { deleted: { bookings, email_sequences, medical_declarations, customer } }
//
// Deletes the customer + their bookings + queued emails + medical declarations.
// Does NOT delete da_billing_runs (financial records, separate legal retention).
// Audit-logged. HQ only.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
    return (JSON.parse(atob(padded)) as any).sub ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) return jsonResponse({ error: 'Invalid JWT' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const caller = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'Only HQ can run an erasure' }, 403);
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'a valid email is required' }, 400);

  const cust = await admin.from('da_customers').select('id').eq('email', email).maybeSingle();
  if (cust.error) {
    console.error('customer lookup failed', cust.error);
    return jsonResponse({ error: 'Lookup failed' }, 500);
  }

  const counts = { bookings: 0, email_sequences: 0, medical_declarations: 0, customer: 0 };

  // Medical declarations are keyed by attendee_email (and/or booking).
  const medByEmail = await admin
    .from('da_medical_declarations')
    .delete()
    .eq('attendee_email', email)
    .select('id');
  counts.medical_declarations += (medByEmail.data ?? []).length;

  if (cust.data) {
    const customerId = (cust.data as any).id;
    const bookings = await admin.from('da_bookings').select('id').eq('customer_id', customerId);
    const bookingIds = (bookings.data ?? []).map((b: any) => b.id);

    // email_sequences reference booking + customer (FK) — delete first.
    const es = await admin
      .from('da_email_sequences')
      .delete()
      .eq('customer_id', customerId)
      .select('id');
    counts.email_sequences = (es.data ?? []).length;

    if (bookingIds.length > 0) {
      // Any medical declarations linked to these bookings (not caught by email).
      const medByBooking = await admin
        .from('da_medical_declarations')
        .delete()
        .in('booking_id', bookingIds)
        .select('id');
      counts.medical_declarations += (medByBooking.data ?? []).length;
    }

    const delBookings = await admin
      .from('da_bookings')
      .delete()
      .eq('customer_id', customerId)
      .select('id');
    counts.bookings = (delBookings.data ?? []).length;

    const delCust = await admin.from('da_customers').delete().eq('id', customerId).select('id');
    counts.customer = (delCust.data ?? []).length;
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'hq',
      actor_id: (caller.data as any).id,
      entity_type: 'gdpr',
      entity_id: crypto.randomUUID(),
      action: 'gdpr_erasure',
      metadata: { email_hash: email.replace(/(.).+(@.*)/, '$1***$2'), counts },
      description: `GDPR erasure run by ${(caller.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('erasure activity insert failed', r.error);
    });

  return jsonResponse({ deleted: counts }, 200);
});

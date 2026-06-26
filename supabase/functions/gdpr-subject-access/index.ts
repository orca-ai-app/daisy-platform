// supabase/functions/gdpr-subject-access/index.ts
//
// HQ-ONLY (JWT) — UK GDPR subject access request. PRD §12.3.
//
// POST { email } -> 200 { customer, bookings, email_sequences, medical_declarations }
//
// Returns everything held for an email as JSON (HQ downloads, gives to the
// customer). Medical health fields are decrypted (the data subject is entitled
// to their own data). Audit-logged. HQ only.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { decryptJson } from '../_shared/medicalCrypto.ts';

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
    return jsonResponse({ error: 'Only HQ can run a subject access request' }, 403);
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: 'a valid email is required' }, 400);

  const customer = await admin.from('da_customers').select('*').eq('email', email).maybeSingle();
  const customerId = (customer.data as any)?.id ?? null;

  let bookings: any[] = [];
  let emailSequences: any[] = [];
  if (customerId) {
    const bRes = await admin
      .from('da_bookings')
      .select(
        'booking_reference, quantity, total_price_pence, payment_status, booking_status, created_at, course_instance:da_course_instances(event_date, venue_postcode, template:da_course_templates(name))',
      )
      .eq('customer_id', customerId);
    bookings = bRes.data ?? [];
    const esRes = await admin
      .from('da_email_sequences')
      .select('template_key, sequence_day, scheduled_for, sent_at, status')
      .eq('customer_id', customerId);
    emailSequences = esRes.data ?? [];
  }

  // Medical declarations by attendee_email — decrypt the health fields (the
  // subject is entitled to their own data).
  const medRes = await admin
    .from('da_medical_declarations')
    .select(
      'id, attendee_name, attendee_email, territory_postcode, declaration_data, consent_given, consent_timestamp, created_at',
    )
    .eq('attendee_email', email);
  const medical: any[] = [];
  for (const m of (medRes.data ?? []) as any[]) {
    let data: unknown = null;
    try {
      data = await decryptJson(m.declaration_data as string);
    } catch {
      data = '[could not decrypt]';
    }
    medical.push({
      id: m.id,
      attendee_name: m.attendee_name,
      territory_postcode: m.territory_postcode,
      consent_given: m.consent_given,
      consent_timestamp: m.consent_timestamp,
      created_at: m.created_at,
      declaration_data: data,
    });
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'hq',
      actor_id: (caller.data as any).id,
      entity_type: 'gdpr',
      entity_id: crypto.randomUUID(),
      action: 'gdpr_subject_access',
      metadata: { email_hash: email.replace(/(.).+(@.*)/, '$1***$2') },
      description: `GDPR subject access export run by ${(caller.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('SAR activity insert failed', r.error);
    });

  return jsonResponse(
    {
      email,
      customer: customer.data ?? null,
      bookings,
      email_sequences: emailSequences,
      medical_declarations: medical,
    },
    200,
  );
});

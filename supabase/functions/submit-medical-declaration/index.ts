// supabase/functions/submit-medical-declaration/index.ts
//
// PUBLIC (no auth) — the medical declaration app's submit endpoint. PRD §5.8.
//
// POST {
//   instructor_number: string,     // da_franchisees.number
//   territory_postcode: string,
//   attendee_name: string,
//   attendee_email?: string,
//   declaration_data: object,      // raw health fields (PRD §10.3)
//   consent_given: boolean
// }
// -> 201 { success: true }   (no sensitive data echoed back)
//
// Encrypts declaration_data (AES-256-GCM, key from the ENCRYPTION_KEY secret)
// before insert. Best-effort links to a recent course instance for the
// instructor + postcode. Health data is special-category (UK GDPR Art. 9):
// consent is mandatory, the row carries a retention-expiry, and franchisees can
// never read the health fields (only HQ, via decrypt-medical-declaration).
// Rate-limit 50/IP/hr (PRD §12.5).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { encryptJson } from '../_shared/medicalCrypto.ts';

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

function reqStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

const RATE_LIMIT = 50;
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

interface RequestBody {
  instructor_number?: unknown;
  territory_postcode?: unknown;
  attendee_name?: unknown;
  attendee_email?: unknown;
  declaration_data?: unknown;
  consent_given?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown';
  if (rateLimited(ip)) return jsonResponse({ error: 'Too many requests. Please slow down.' }, 429);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const instructorNumber = reqStr(body.instructor_number);
  const territoryPostcode = reqStr(body.territory_postcode);
  const attendeeName = reqStr(body.attendee_name);
  if (!instructorNumber) return jsonResponse({ error: 'instructor_number is required' }, 400);
  if (!territoryPostcode) return jsonResponse({ error: 'territory_postcode is required' }, 400);
  if (!attendeeName) return jsonResponse({ error: 'attendee_name is required' }, 400);

  // Consent is mandatory for special-category health data.
  if (body.consent_given !== true) {
    return jsonResponse({ error: 'Consent is required to submit a medical declaration' }, 400);
  }
  if (typeof body.declaration_data !== 'object' || body.declaration_data === null) {
    return jsonResponse({ error: 'declaration_data is required' }, 400);
  }

  // --- Resolve instructor (franchisee) --------------------------------------
  const frRes = await admin
    .from('da_franchisees')
    .select('id')
    .eq('number', instructorNumber)
    .maybeSingle();
  if (frRes.error) {
    console.error('franchisee lookup failed', frRes.error);
    return jsonResponse({ error: 'Could not submit right now' }, 500);
  }
  if (!frRes.data) return jsonResponse({ error: 'Instructor not found' }, 404);
  const franchiseeId = (frRes.data as any).id;

  // --- Best-effort link to a recent course instance -------------------------
  // Same franchisee + matching venue postcode prefix, within the last 24h.
  let courseInstanceId: string | null = null;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const prefix =
    territoryPostcode.toUpperCase().replace(/\s+/g, '').slice(0, -3) || territoryPostcode;
  const ciRes = await admin
    .from('da_course_instances')
    .select('id, venue_postcode, event_date')
    .eq('franchisee_id', franchiseeId)
    .gte('event_date', since)
    .order('event_date', { ascending: false })
    .limit(20);
  if (ciRes.data) {
    const match = (ciRes.data as any[]).find((c) =>
      (c.venue_postcode ?? '').toUpperCase().replace(/\s+/g, '').startsWith(prefix.toUpperCase()),
    );
    courseInstanceId = match?.id ?? null;
  }

  // --- Retention window from settings (default 3 years) ---------------------
  const retSetting = await admin
    .from('da_settings')
    .select('value')
    .eq('key', 'gdpr_medical_retention_years')
    .maybeSingle();
  const years = Number((retSetting.data as any)?.value) || 3;
  const retentionExpires = new Date();
  retentionExpires.setUTCFullYear(retentionExpires.getUTCFullYear() + years);

  // --- Encrypt + insert -----------------------------------------------------
  let encrypted: string;
  try {
    encrypted = await encryptJson(body.declaration_data);
  } catch (err) {
    console.error('encryption failed', err);
    return jsonResponse({ error: 'Could not securely store your declaration' }, 500);
  }

  const ins = await admin
    .from('da_medical_declarations')
    .insert({
      franchisee_id: franchiseeId,
      territory_postcode: territoryPostcode.toUpperCase(),
      course_instance_id: courseInstanceId,
      attendee_name: attendeeName,
      attendee_email: reqStr(body.attendee_email)?.toLowerCase() ?? null,
      declaration_data: encrypted,
      consent_given: true,
      consent_timestamp: new Date().toISOString(),
      gdpr_retention_expires_at: retentionExpires.toISOString(),
      ip_address: ip !== 'unknown' ? ip : null,
      user_agent: req.headers.get('user-agent'),
    })
    .select('id')
    .single();

  if (ins.error || !ins.data) {
    console.error('medical declaration insert failed', ins.error);
    return jsonResponse({ error: 'Could not submit your declaration' }, 500);
  }

  // Activity row carries NO health data — just that a declaration was submitted.
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'medical_declaration',
      entity_id: (ins.data as any).id,
      action: 'medical_declaration_submitted',
      metadata: {
        franchisee_id: franchiseeId,
        territory_postcode: territoryPostcode.toUpperCase(),
      },
      description: `Medical declaration submitted for instructor ${instructorNumber}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('activity insert failed', r.error);
    });

  return jsonResponse({ success: true }, 201);
});

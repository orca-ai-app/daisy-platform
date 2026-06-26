// supabase/functions/decrypt-medical-declaration/index.ts
//
// HQ-ONLY (JWT verified) — decrypts ONE medical declaration's health fields.
// PRD §12.1. Every access is audit-logged (medical_decryption_accessed) — this
// log IS the compliance trail for who viewed special-category data and when.
//
// POST { declaration_id: string } -> 200 { declaration_id, attendee_name, declaration_data }
//
// Only callers whose da_franchisees row has is_hq = true may decrypt.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { decryptJson } from '../_shared/medicalCrypto.ts';

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
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // --- HQ gate --------------------------------------------------------------
  const caller = await admin
    .from('da_franchisees')
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error) {
    console.error('caller lookup failed', caller.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'Only HQ can decrypt medical declarations' }, 403);
  }

  let body: { declaration_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  const declarationId =
    typeof body.declaration_id === 'string' && UUID_RE.test(body.declaration_id)
      ? body.declaration_id
      : null;
  if (!declarationId) return jsonResponse({ error: 'declaration_id is required (uuid)' }, 400);

  const row = await admin
    .from('da_medical_declarations')
    .select('id, attendee_name, attendee_email, declaration_data, consent_given, created_at')
    .eq('id', declarationId)
    .maybeSingle();
  if (row.error) {
    console.error('declaration lookup failed', row.error);
    return jsonResponse({ error: 'Failed to load declaration' }, 500);
  }
  if (!row.data) return jsonResponse({ error: 'Declaration not found' }, 404);

  let declarationData: unknown;
  try {
    declarationData = await decryptJson((row.data as any).declaration_data as string);
  } catch (err) {
    console.error('decryption failed', err);
    return jsonResponse({ error: 'Could not decrypt this declaration' }, 500);
  }

  // Audit the access — the compliance trail.
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'hq',
      actor_id: (caller.data as any).id,
      entity_type: 'medical_declaration',
      entity_id: declarationId,
      action: 'medical_decryption_accessed',
      metadata: { accessed_by: (caller.data as any).name },
      description: `HQ ${(caller.data as any).name} decrypted medical declaration ${declarationId}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('audit insert failed', r.error);
    });

  return jsonResponse(
    {
      declaration_id: declarationId,
      attendee_name: (row.data as any).attendee_name,
      attendee_email: (row.data as any).attendee_email,
      declaration_data: declarationData,
    },
    200,
  );
});

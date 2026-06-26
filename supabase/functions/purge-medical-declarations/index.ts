// supabase/functions/purge-medical-declarations/index.ts
//
// HQ-ONLY (JWT verified) — on-demand GDPR retention purge for HQ. PRD §5.7.
//
// The SCHEDULED nightly purge runs as a direct pg_cron SQL job (migration 029),
// not through this function — that avoids a cron→function auth dance and keeps
// the destructive delete inside the database. This endpoint is the manual
// "purge now" button for HQ.
//
// POST {} -> 200 { purged: number }   (HQ JWT required)
//
// DELETE FROM da_medical_declarations
//   WHERE gdpr_retention_expires_at < NOW() AND consent_given = TRUE;

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
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);

  // HQ-only manual trigger (the scheduled purge is a pg_cron SQL job, migration 029).
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) return jsonResponse({ error: 'Invalid JWT' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const caller = await admin
    .from('da_franchisees')
    .select('is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'Only HQ can run a purge' }, 403);
  }
  const nowIso = new Date().toISOString();

  // Select the expired ids first so we can log an accurate count.
  const expired = await admin
    .from('da_medical_declarations')
    .select('id')
    .eq('consent_given', true)
    .lt('gdpr_retention_expires_at', nowIso);
  if (expired.error) {
    console.error('purge select failed', expired.error);
    return jsonResponse({ error: 'Purge query failed' }, 500);
  }
  const ids = (expired.data ?? []).map((r: any) => r.id);

  if (ids.length === 0) {
    return jsonResponse({ purged: 0 }, 200);
  }

  const del = await admin.from('da_medical_declarations').delete().in('id', ids);
  if (del.error) {
    console.error('purge delete failed', del.error);
    return jsonResponse({ error: 'Purge delete failed' }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'medical_declaration',
      entity_id: crypto.randomUUID(),
      action: 'medical_declarations_purged',
      metadata: { count: ids.length, purged_at: nowIso },
      description: `Purged ${ids.length} expired medical declaration(s) past GDPR retention`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('purge activity insert failed', r.error);
    });

  return jsonResponse({ purged: ids.length }, 200);
});

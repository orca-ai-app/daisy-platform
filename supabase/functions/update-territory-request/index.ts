// supabase/functions/update-territory-request/index.ts
//
// POST { id: string, status: 'reviewing'|'approved'|'declined' }  (auth: HQ JWT)
//   -> { request: { id, status, handled_at } }
//
// HQ actions a franchisee territory request from the dashboard Attention list /
// the Territory requests page. Only HQ users may call this.
//
// Deploy flag: default (verify_jwt on).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_STATUS = new Set(['reviewing', 'approved', 'declined']);

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ error: 'Authorization header required' }, 401);
    }
    const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
    if (!authUserId) {
      return jsonResponse({ error: 'Invalid JWT' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500);
    }

    let body: { id?: string; status?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    const id = (body.id ?? '').trim();
    const status = (body.status ?? '').trim();
    if (!id || !ALLOWED_STATUS.has(status)) {
      return jsonResponse({ error: 'id and a valid status are required' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // Only HQ users may action requests.
    const caller = await admin
      .from('da_franchisees')
      .select('id, is_hq')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    if (caller.error) {
      console.error('update-territory-request: caller lookup failed', caller.error);
      return jsonResponse({ error: 'Failed to verify caller' }, 500);
    }
    if (!caller.data || !(caller.data as { is_hq: boolean }).is_hq) {
      return jsonResponse({ error: 'HQ access required' }, 403);
    }

    const update = await admin
      .from('da_territory_requests')
      .update({
        status,
        handled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, status, handled_at')
      .single();

    if (update.error || !update.data) {
      console.error('update-territory-request: update failed', update.error);
      return jsonResponse({ error: 'Could not update the request.' }, 500);
    }

    const activity = await admin.from('da_activities').insert({
      actor_type: 'hq',
      actor_id: (caller.data as { id: string }).id,
      entity_type: 'territory_request',
      entity_id: id,
      action: 'territory_request_updated',
      metadata: { status },
      description: `Territory request marked ${status}`,
    });
    if (activity.error) {
      console.error('update-territory-request: activity insert failed', activity.error);
    }

    return jsonResponse({ request: update.data }, 200);
  } catch (err) {
    console.error('update-territory-request: uncaught', err);
    return jsonResponse({ error: 'Could not update the request.' }, 500);
  }
});

// supabase/functions/create-territory-request/index.ts
//
// POST { area: string, note?: string }  (auth: franchisee JWT)
//   -> { request: { id, area, note, status, created_at } }
//
// Stores a franchisee's territory request. New rows surface in the HQ dashboard
// Attention list (count of status='new'). Replaces the old mailto: link.
//
// Deploy flag: default (verify_jwt on) — client sends the franchisee access token.

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

    let body: { area?: string; note?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    const area = (body.area ?? '').trim();
    const note = (body.note ?? '').trim();
    if (!area) {
      return jsonResponse({ error: 'Please describe the territory you want.' }, 400);
    }
    if (area.length > 200 || note.length > 1000) {
      return jsonResponse({ error: 'Request is too long.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const selfLookup = await admin
      .from('da_franchisees')
      .select('id, name')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (selfLookup.error) {
      console.error('create-territory-request: franchisee lookup failed', selfLookup.error);
      return jsonResponse({ error: 'Failed to verify caller' }, 500);
    }
    if (!selfLookup.data) {
      return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
    }
    const franchisee = selfLookup.data as { id: string; name: string };

    const insert = await admin
      .from('da_territory_requests')
      .insert({ franchisee_id: franchisee.id, area, note: note || null })
      .select('id, area, note, status, created_at')
      .single();

    if (insert.error || !insert.data) {
      console.error('create-territory-request: insert failed', insert.error);
      return jsonResponse({ error: 'Could not submit your request. Please try again.' }, 500);
    }

    // Activity log — non-fatal.
    const activity = await admin.from('da_activities').insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'territory_request',
      entity_id: (insert.data as { id: string }).id,
      action: 'territory_requested',
      metadata: { area, note: note || null },
      description: `${franchisee.name} requested a territory: ${area}`,
    });
    if (activity.error) {
      console.error('create-territory-request: activity insert failed', activity.error);
    }

    return jsonResponse({ request: insert.data }, 200);
  } catch (err) {
    console.error('create-territory-request: uncaught', err);
    return jsonResponse({ error: 'Could not submit your request. Please try again.' }, 500);
  }
});

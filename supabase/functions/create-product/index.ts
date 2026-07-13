// supabase/functions/create-product/index.ts
//
// HQ-ONLY — adds a product to the network merchandise catalogue (migration
// 038). Franchisees record sales against catalogue rows; they cannot create
// products themselves (brand + pricing control stays with HQ).
//
// POST { name, description?, rrp_pence, active?, sort_order? } -> 201 row
// Errors: { error, request_id } — 400/401/403/500.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { logSystem, newRequestId } from '../_shared/log.ts';

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

  const requestId = newRequestId();

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required', request_id: requestId }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) return jsonResponse({ error: 'Invalid JWT', request_id: requestId }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured', request_id: requestId }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const caller = await admin
    .from('da_franchisees')
    .select('id, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error || !caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'HQ access required', request_id: requestId }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body', request_id: requestId }, 400);
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) {
    return jsonResponse(
      { error: 'name is required (max 120 characters)', request_id: requestId },
      400,
    );
  }
  const rrp = body?.rrp_pence;
  if (typeof rrp !== 'number' || !Number.isInteger(rrp) || rrp < 0 || rrp > 100_000_00) {
    return jsonResponse(
      { error: 'rrp_pence must be a non-negative whole number of pence', request_id: requestId },
      400,
    );
  }
  const description =
    typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim().slice(0, 500)
      : null;
  const active = typeof body?.active === 'boolean' ? body.active : true;
  const sortOrder =
    typeof body?.sort_order === 'number' && Number.isInteger(body.sort_order) ? body.sort_order : 0;

  const ins = await admin
    .from('da_products')
    .insert({ name, description, rrp_pence: rrp, active, sort_order: sortOrder })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    await logSystem(admin, {
      level: 'error',
      source: 'create-product',
      requestId,
      message: `product insert failed: ${ins.error?.message}`,
    });
    return jsonResponse({ error: 'Could not create the product', request_id: requestId }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'hq',
      actor_id: (caller.data as any).id,
      entity_type: 'product',
      entity_id: (ins.data as any).id,
      action: 'product_created',
      metadata: { name, rrp_pence: rrp, active },
      description: `Product added to catalogue: ${name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_created activity insert failed', r.error);
    });

  return jsonResponse(ins.data, 201);
});

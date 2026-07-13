// supabase/functions/update-product/index.ts
//
// HQ-ONLY — edits a merchandise catalogue row (migration 038): name,
// description, RRP, active flag, sort order. Price changes only affect future
// sales (unit_price_pence is copied onto each da_product_sales row at sale
// time), so history is never rewritten.
//
// POST { product_id, name?, description?, rrp_pence?, active?, sort_order? } -> 200 row
// Errors: { error, request_id } — 400/401/403/404/500.

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const productId = typeof body?.product_id === 'string' ? body.product_id : '';
  if (!UUID_RE.test(productId)) {
    return jsonResponse({ error: 'product_id is required', request_id: requestId }, 400);
  }

  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) {
      return jsonResponse({ error: 'name must be 1-120 characters', request_id: requestId }, 400);
    }
    patch.name = name;
  }
  if (body?.description !== undefined) {
    patch.description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 500)
        : null;
  }
  if (body?.rrp_pence !== undefined) {
    const rrp = body.rrp_pence;
    if (typeof rrp !== 'number' || !Number.isInteger(rrp) || rrp < 0 || rrp > 100_000_00) {
      return jsonResponse(
        { error: 'rrp_pence must be a non-negative whole number of pence', request_id: requestId },
        400,
      );
    }
    patch.rrp_pence = rrp;
  }
  if (body?.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return jsonResponse({ error: 'active must be a boolean', request_id: requestId }, 400);
    }
    patch.active = body.active;
  }
  if (body?.sort_order !== undefined) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return jsonResponse(
        { error: 'sort_order must be a whole number', request_id: requestId },
        400,
      );
    }
    patch.sort_order = body.sort_order;
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: 'Nothing to update', request_id: requestId }, 400);
  }

  const upd = await admin
    .from('da_products')
    .update(patch)
    .eq('id', productId)
    .select('*')
    .maybeSingle();
  if (upd.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'update-product',
      requestId,
      message: `product update failed: ${upd.error.message}`,
    });
    return jsonResponse({ error: 'Could not update the product', request_id: requestId }, 500);
  }
  if (!upd.data) return jsonResponse({ error: 'Product not found', request_id: requestId }, 404);

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'hq',
      actor_id: (caller.data as any).id,
      entity_type: 'product',
      entity_id: productId,
      action: 'product_updated',
      metadata: { changes: patch },
      description: `Product updated: ${(upd.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_updated activity insert failed', r.error);
    });

  return jsonResponse(upd.data, 200);
});

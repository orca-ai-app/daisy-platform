// supabase/functions/delete-product-sale/index.ts
//
// FRANCHISEE — deletes one of the caller's own merchandise sale rows
// (fat-finger corrections). Migration 038.
//
// POST { sale_id: string } -> 200 { ok: true }
//
// Blocked (409) when a da_billing_runs row exists whose period covers the
// sale's sold_at date — the figure has already been billed; HQ must adjust.
// Every delete writes a da_activities row containing the sale snapshot.
// Errors: { error, request_id }.

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
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error || !caller.data) {
    return jsonResponse(
      { error: 'No franchisee account for this login', request_id: requestId },
      403,
    );
  }
  const franchiseeId = (caller.data as any).id as string;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body', request_id: requestId }, 400);
  }
  const saleId = typeof body?.sale_id === 'string' ? body.sale_id : '';
  if (!UUID_RE.test(saleId)) {
    return jsonResponse({ error: 'sale_id is required', request_id: requestId }, 400);
  }

  const sale = await admin
    .from('da_product_sales')
    .select(
      'id, franchisee_id, product_id, quantity, unit_price_pence, total_pence, payment_method, sold_at, note',
    )
    .eq('id', saleId)
    .maybeSingle();
  if (sale.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'delete-product-sale',
      requestId,
      message: `sale lookup failed: ${sale.error.message}`,
    });
    return jsonResponse({ error: 'Could not load the sale', request_id: requestId }, 500);
  }
  if (!sale.data) return jsonResponse({ error: 'Sale not found', request_id: requestId }, 404);
  const s = sale.data as any;
  if (s.franchisee_id !== franchiseeId) {
    return jsonResponse({ error: 'That sale is not yours', request_id: requestId }, 403);
  }

  // Billing lock: once a run FOR THIS FRANCHISEE covers the sale date, the
  // figure is spoken for.
  const billed = await admin
    .from('da_billing_runs')
    .select('id')
    .eq('franchisee_id', franchiseeId)
    .lte('billing_period_start', s.sold_at)
    .gte('billing_period_end', s.sold_at)
    .limit(1);
  if (billed.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'delete-product-sale',
      requestId,
      message: `billing-run check failed: ${billed.error.message}`,
    });
    return jsonResponse({ error: 'Could not verify billing status', request_id: requestId }, 500);
  }
  if ((billed.data ?? []).length > 0) {
    return jsonResponse(
      {
        error: 'This sale falls in a period that has already been billed — contact HQ to adjust it',
        request_id: requestId,
      },
      409,
    );
  }

  const del = await admin.from('da_product_sales').delete().eq('id', saleId);
  if (del.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'delete-product-sale',
      requestId,
      actor: franchiseeId,
      message: `sale delete failed: ${del.error.message}`,
    });
    return jsonResponse({ error: 'Could not delete the sale', request_id: requestId }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchiseeId,
      entity_type: 'product_sale',
      entity_id: saleId,
      action: 'product_sale_deleted',
      metadata: {
        snapshot: {
          product_id: s.product_id,
          quantity: s.quantity,
          unit_price_pence: s.unit_price_pence,
          total_pence: s.total_pence,
          payment_method: s.payment_method,
          sold_at: s.sold_at,
          note: s.note,
        },
      },
      description: `Deleted a recorded product sale (${s.sold_at})`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_sale_deleted activity insert failed', r.error);
    });

  return jsonResponse({ ok: true }, 200);
});

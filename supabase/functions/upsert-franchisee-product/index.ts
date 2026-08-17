// supabase/functions/upsert-franchisee-product/index.ts
//
// FRANCHISEE — sets their own price and online visibility for an HQ catalogue
// product (migration 044). HQ owns the catalogue and the RRP; the franchisee
// owns whether the item is listed on their booking site and what it costs,
// exactly as they own their course prices.
//
// POST {
//   product_id:   string   — active da_products row
//   price_pence:  integer  — >= 0 (prefilled from RRP client-side, theirs to change)
//   is_online:    boolean  — TRUE lists it to customers via get-public-items
//   vat_rate?:    number   — percentage the price includes (e.g. 20), null clears
// }
// -> 200 upserted da_franchisee_products row
//
// Upserts on (franchisee_id, product_id) — calling it again just edits the
// existing listing. Auth: Bearer JWT → da_franchisees via auth_user_id;
// franchisee_id stamped server-side. Errors: { error, request_id } — 400/401/403/404/500.

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
  if (caller.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'upsert-franchisee-product',
      requestId,
      message: `caller lookup failed: ${caller.error.message}`,
    });
    return jsonResponse({ error: 'Failed to verify caller', request_id: requestId }, 500);
  }
  if (!caller.data) {
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

  // --- Validation -------------------------------------------------------------
  const productId = typeof body?.product_id === 'string' ? body.product_id : '';
  if (!UUID_RE.test(productId)) {
    return jsonResponse({ error: 'product_id is required', request_id: requestId }, 400);
  }
  const pricePence = body?.price_pence;
  if (
    typeof pricePence !== 'number' ||
    !Number.isInteger(pricePence) ||
    pricePence < 0 ||
    pricePence > 100_000_00
  ) {
    return jsonResponse(
      { error: 'price_pence must be a non-negative whole number of pence', request_id: requestId },
      400,
    );
  }
  if (typeof body?.is_online !== 'boolean') {
    return jsonResponse({ error: 'is_online must be a boolean', request_id: requestId }, 400);
  }
  const isOnline = body.is_online as boolean;

  let vatRate: number | null = null;
  if (body?.vat_rate != null) {
    const v = body.vat_rate;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 99.99) {
      return jsonResponse(
        { error: 'vat_rate must be a percentage between 0 and 99.99', request_id: requestId },
        400,
      );
    }
    vatRate = Math.round(v * 100) / 100;
  }

  // Product must exist and be active — a franchisee cannot list a product HQ
  // has retired. Since migration 046 it must also be one they can see: an HQ
  // network item or their own; never another franchisee's.
  const product = await admin
    .from('da_products')
    .select('id, name, active, kind, fulfilment_url, franchisee_id')
    .eq('id', productId)
    .maybeSingle();
  if (product.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'upsert-franchisee-product',
      requestId,
      message: `product lookup failed: ${product.error.message}`,
    });
    return jsonResponse({ error: 'Could not load the product', request_id: requestId }, 500);
  }
  if (!product.data) {
    return jsonResponse({ error: 'Product not found', request_id: requestId }, 404);
  }
  if (!(product.data as any).active) {
    return jsonResponse(
      { error: 'That product is not currently available', request_id: requestId },
      400,
    );
  }
  const productOwnerId = ((product.data as any).franchisee_id ?? null) as string | null;
  if (productOwnerId !== null && productOwnerId !== franchiseeId) {
    return jsonResponse({ error: 'Product not found', request_id: requestId }, 404);
  }
  // An HQ e-learning item with no access link would take money and deliver
  // nothing — HQ must set fulfilment_url before it can go online. A
  // franchisee's OWN e-learning item is different: they fulfil it by hand
  // (licence keys enrolled through elearnhere) and the confirmation email tells
  // the buyer access follows separately, so no link is expected.
  if (
    isOnline &&
    productOwnerId === null &&
    (product.data as any).kind === 'elearning' &&
    !(product.data as any).fulfilment_url
  ) {
    return jsonResponse(
      {
        error:
          'That e-learning course has no access link set by HQ yet, so it cannot be sold online',
        request_id: requestId,
      },
      400,
    );
  }

  // --- Upsert on (franchisee_id, product_id) ----------------------------------
  const up = await admin
    .from('da_franchisee_products')
    .upsert(
      {
        franchisee_id: franchiseeId,
        product_id: productId,
        price_pence: pricePence,
        is_online: isOnline,
        vat_rate: vatRate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'franchisee_id,product_id', ignoreDuplicates: false },
    )
    .select('*')
    .single();
  if (up.error || !up.data) {
    await logSystem(admin, {
      level: 'error',
      source: 'upsert-franchisee-product',
      requestId,
      actor: franchiseeId,
      message: `franchisee product upsert failed: ${up.error?.message}`,
    });
    return jsonResponse({ error: 'Could not save the item', request_id: requestId }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchiseeId,
      entity_type: 'franchisee_product',
      entity_id: (up.data as any).id,
      action: 'franchisee_product_saved',
      metadata: {
        product: (product.data as any).name,
        product_id: productId,
        price_pence: pricePence,
        is_online: isOnline,
        vat_rate: vatRate,
      },
      description: `${isOnline ? 'Listed' : 'Unlisted'} item: ${(product.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('franchisee_product_saved activity insert failed', r.error);
    });

  return jsonResponse(up.data, 200);
});

// supabase/functions/create-product-sale/index.ts
//
// FRANCHISEE — records an in-person merchandise sale (books/kits at a class).
// Migration 038. Merch revenue counts towards the monthly franchise fee
// (preview-billing-run pools it into the territory 10% test).
//
// POST {
//   product_id:        string   — active da_products row
//   quantity:          integer  — > 0
//   unit_price_pence:  integer  — >= 0 (prefilled from RRP client-side, editable
//                                 for postage/discounts; total computed HERE)
//   payment_method:    'cash' | 'card' | 'other'
//   sold_at:           'YYYY-MM-DD' — today or past (recording after class)
//   course_instance_id?: string  — must belong to the caller
//   note?:             string
// }
// -> 201 inserted da_product_sales row
//
// Auth: Bearer JWT → da_franchisees via auth_user_id; franchisee_id stamped
// server-side. Errors: { error, request_id } — 400/401/403/404/500.

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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
      source: 'create-product-sale',
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
  const quantity = body?.quantity;
  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 500
  ) {
    return jsonResponse(
      { error: 'quantity must be a whole number of at least 1', request_id: requestId },
      400,
    );
  }
  const unitPrice = body?.unit_price_pence;
  if (
    typeof unitPrice !== 'number' ||
    !Number.isInteger(unitPrice) ||
    unitPrice < 0 ||
    unitPrice > 100_000_00
  ) {
    return jsonResponse(
      {
        error: 'unit_price_pence must be a non-negative whole number of pence',
        request_id: requestId,
      },
      400,
    );
  }
  const paymentMethod = body?.payment_method;
  if (!['cash', 'card', 'other'].includes(paymentMethod)) {
    return jsonResponse(
      { error: "payment_method must be 'cash', 'card' or 'other'", request_id: requestId },
      400,
    );
  }
  const soldAt = typeof body?.sold_at === 'string' ? body.sold_at : '';
  if (!DATE_RE.test(soldAt) || Number.isNaN(new Date(`${soldAt}T00:00:00Z`).getTime())) {
    return jsonResponse(
      { error: 'sold_at must be a valid YYYY-MM-DD date', request_id: requestId },
      400,
    );
  }
  // Today or past only (UTC date-level comparison — a class is never recorded
  // before it has happened; allow "today" generously across timezones).
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (soldAt > todayUtc) {
    return jsonResponse({ error: 'sold_at cannot be in the future', request_id: requestId }, 400);
  }
  const note =
    typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  // Product must exist and be active.
  const product = await admin
    .from('da_products')
    .select('id, name, active')
    .eq('id', productId)
    .maybeSingle();
  if (product.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'create-product-sale',
      requestId,
      message: `product lookup failed: ${product.error.message}`,
    });
    return jsonResponse({ error: 'Could not load the product', request_id: requestId }, 500);
  }
  if (!product.data)
    return jsonResponse({ error: 'Product not found', request_id: requestId }, 404);
  if (!(product.data as any).active) {
    return jsonResponse(
      { error: 'That product is not currently available', request_id: requestId },
      400,
    );
  }

  // Optional class link: must be the caller's own course instance.
  let courseInstanceId: string | null = null;
  if (body?.course_instance_id != null && body.course_instance_id !== '') {
    const ciId = typeof body.course_instance_id === 'string' ? body.course_instance_id : '';
    if (!UUID_RE.test(ciId)) {
      return jsonResponse({ error: 'course_instance_id is not valid', request_id: requestId }, 400);
    }
    const ci = await admin
      .from('da_course_instances')
      .select('id, franchisee_id')
      .eq('id', ciId)
      .maybeSingle();
    if (!ci.data || (ci.data as any).franchisee_id !== franchiseeId) {
      return jsonResponse({ error: 'That class is not one of yours', request_id: requestId }, 403);
    }
    courseInstanceId = ciId;
  }

  // --- Insert (total computed server-side) ------------------------------------
  const totalPence = quantity * unitPrice;
  const ins = await admin
    .from('da_product_sales')
    .insert({
      franchisee_id: franchiseeId,
      product_id: productId,
      quantity,
      unit_price_pence: unitPrice,
      total_pence: totalPence,
      payment_method: paymentMethod,
      sold_at: soldAt,
      course_instance_id: courseInstanceId,
      note,
    })
    .select('*')
    .single();
  if (ins.error || !ins.data) {
    await logSystem(admin, {
      level: 'error',
      source: 'create-product-sale',
      requestId,
      actor: franchiseeId,
      message: `sale insert failed: ${ins.error?.message}`,
    });
    return jsonResponse({ error: 'Could not record the sale', request_id: requestId }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchiseeId,
      entity_type: 'product_sale',
      entity_id: (ins.data as any).id,
      action: 'product_sale_recorded',
      metadata: {
        product: (product.data as any).name,
        quantity,
        total_pence: totalPence,
        payment_method: paymentMethod,
        sold_at: soldAt,
      },
      description: `Recorded sale: ${quantity} × ${(product.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_sale_recorded activity insert failed', r.error);
    });

  return jsonResponse(ins.data, 201);
});

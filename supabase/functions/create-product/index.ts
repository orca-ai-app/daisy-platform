// supabase/functions/create-product/index.ts
//
// Adds a product to the merchandise catalogue (migration 038). Two callers:
//
//   HQ (is_hq)   — creates a NETWORK item (franchisee_id NULL) visible to every
//                  franchisee. Full control: rrp_pence, sort_order, active,
//                  fulfilment_url.
//   Franchisee   — creates THEIR OWN item (franchisee_id stamped from the JWT,
//                  migration 046). Hannah cannot add her second e-learning
//                  course while the catalogue is HQ-only. Their own items are
//                  visible and editable only to them.
//
// A franchisee's own item is deliberately narrower: rrp_pence is forced to 0
// (their selling price lives on their da_franchisee_products listing, not on a
// network RRP), sort_order is forced to 0, and fulfilment_url is ignored — HQ
// owns access links, and a franchisee's e-learning is fulfilled by hand
// (licence keys enrolled through elearnhere), which is exactly what
// fulfilment_notes is for.
//
// POST {
//   name, description?, rrp_pence?, active?, sort_order?,
//   kind?: 'physical' | 'elearning',   // default 'physical'
//   fulfilment_url?: string,           // HQ only; https, REQUIRED when kind='elearning'
//   fulfilment_notes?: string
// } -> 201 row
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

// An access link must be a real https URL — http would be delivered over a
// broken padlock, and anything else is a typo.
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
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
    .select('id, name, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error || !caller.data) {
    return jsonResponse(
      { error: 'No franchisee account for this login', request_id: requestId },
      403,
    );
  }
  const isHq = Boolean((caller.data as any).is_hq);
  const callerId = (caller.data as any).id as string;
  // NULL = network item (HQ); set = the caller's own item (migration 046).
  const ownerId: string | null = isHq ? null : callerId;

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
  // A network RRP is HQ's to set. A franchisee's own item has no network RRP —
  // their selling price lives on their da_franchisee_products listing — so the
  // column is forced to 0 rather than demanded from them.
  let rrp = 0;
  if (isHq) {
    rrp = body?.rrp_pence;
    if (typeof rrp !== 'number' || !Number.isInteger(rrp) || rrp < 0 || rrp > 100_000_00) {
      return jsonResponse(
        { error: 'rrp_pence must be a non-negative whole number of pence', request_id: requestId },
        400,
      );
    }
  }
  const description =
    typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim().slice(0, 500)
      : null;
  const active = typeof body?.active === 'boolean' ? body.active : true;
  // sort_order orders the network catalogue, so only HQ sets it.
  const sortOrder =
    isHq && typeof body?.sort_order === 'number' && Number.isInteger(body.sort_order)
      ? body.sort_order
      : 0;

  // --- Sellable-item fields (migration 044) -----------------------------------
  const kind = body?.kind === undefined ? 'physical' : body.kind;
  if (kind !== 'physical' && kind !== 'elearning') {
    return jsonResponse(
      { error: "kind must be 'physical' or 'elearning'", request_id: requestId },
      400,
    );
  }
  // Access links are HQ's to set: a franchisee's own e-learning is fulfilled by
  // hand (licence keys enrolled through elearnhere), so an instant link would be
  // a promise they cannot keep. Their item stays link-free and the confirmation
  // email tells the buyer access follows separately.
  const fulfilmentUrl =
    isHq && typeof body?.fulfilment_url === 'string' && body.fulfilment_url.trim()
      ? body.fulfilment_url.trim()
      : null;
  if (fulfilmentUrl && (!isHttpsUrl(fulfilmentUrl) || fulfilmentUrl.length > 2000)) {
    return jsonResponse(
      { error: 'fulfilment_url must be a valid https:// link', request_id: requestId },
      400,
    );
  }
  if (isHq && kind === 'elearning' && !fulfilmentUrl) {
    return jsonResponse(
      {
        error: 'fulfilment_url is required for an e-learning course (where buyers get access)',
        request_id: requestId,
      },
      400,
    );
  }
  const fulfilmentNotes =
    typeof body?.fulfilment_notes === 'string' && body.fulfilment_notes.trim()
      ? body.fulfilment_notes.trim().slice(0, 1000)
      : null;

  const ins = await admin
    .from('da_products')
    .insert({
      name,
      description,
      rrp_pence: rrp,
      active,
      sort_order: sortOrder,
      kind,
      fulfilment_url: fulfilmentUrl,
      fulfilment_notes: fulfilmentNotes,
      franchisee_id: ownerId,
    })
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
      actor_type: isHq ? 'hq' : 'franchisee',
      actor_id: callerId,
      entity_type: 'product',
      entity_id: (ins.data as any).id,
      action: 'product_created',
      metadata: { name, rrp_pence: rrp, active, kind, franchisee_id: ownerId },
      description: isHq
        ? `Product added to catalogue: ${name}`
        : `${(caller.data as any).name} added their own item: ${name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_created activity insert failed', r.error);
    });

  return jsonResponse(ins.data, 201);
});

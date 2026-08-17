// supabase/functions/update-product/index.ts
//
// Edits a merchandise catalogue row (migration 038): name, description, RRP,
// active flag, sort order. Price changes only affect future sales
// (unit_price_pence is copied onto each da_product_sales row at sale time), so
// history is never rewritten.
//
// Migration 044 adds the SELLABLE ITEM fields, which are editable here too —
// without them HQ could never change an e-learning access link once the product
// existed. Validation mirrors create-product: fulfilment_url must be https and
// is required whenever the product ends up as kind='elearning'.
//
// Migration 046 opens this up to franchisees for THEIR OWN items only
// (da_products.franchisee_id = the caller). Feola could not rename anything
// while the catalogue was HQ-only. A franchisee editing an HQ network item, or
// anyone else's item, gets 403 — their price / VAT / visibility on an HQ item
// lives on da_franchisee_products via upsert-franchisee-product instead. RRP,
// sort_order and fulfilment_url stay HQ-only on every row.
//
// POST {
//   product_id, name?, description?, rrp_pence?, active?, sort_order?,
//   kind?: 'physical' | 'elearning',
//   fulfilment_url?: string | null,    // HQ only; https, REQUIRED when kind='elearning'
//   fulfilment_notes?: string | null
// } -> 200 row
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

// An access link must be a real https URL — http would be delivered over a
// broken padlock, and anything else is a typo.
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
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

  // --- Ownership (migration 046) ---------------------------------------------
  // Load the row up front: it decides who may edit it, and the fulfilment rules
  // below need its current kind anyway.
  const existing = await admin
    .from('da_products')
    .select('id, franchisee_id, kind, fulfilment_url')
    .eq('id', productId)
    .maybeSingle();
  if (existing.error) {
    await logSystem(admin, {
      level: 'error',
      source: 'update-product',
      requestId,
      message: `product lookup failed: ${existing.error.message}`,
    });
    return jsonResponse({ error: 'Could not load the product', request_id: requestId }, 500);
  }
  if (!existing.data) {
    return jsonResponse({ error: 'Product not found', request_id: requestId }, 404);
  }
  const current = existing.data as any;
  const ownerId = (current.franchisee_id ?? null) as string | null;

  // HQ edits anything. A franchisee edits only rows they own — an HQ network
  // item is read-only to them (their price/visibility lives on their
  // da_franchisee_products listing instead).
  if (!isHq && ownerId !== callerId) {
    return jsonResponse(
      {
        error:
          ownerId === null
            ? 'This is a network item managed by HQ. You can still set your own price and visibility for it in My shop.'
            : 'You can only edit your own items',
        request_id: requestId,
      },
      403,
    );
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
  // The network RRP is HQ guidance, so only HQ sets it. A franchisee's own
  // selling price lives on their da_franchisee_products listing.
  if (body?.rrp_pence !== undefined && isHq) {
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
  // sort_order orders the network catalogue, so only HQ sets it.
  if (body?.sort_order !== undefined && isHq) {
    if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
      return jsonResponse(
        { error: 'sort_order must be a whole number', request_id: requestId },
        400,
      );
    }
    patch.sort_order = body.sort_order;
  }

  // --- Sellable-item fields (migration 044) -----------------------------------
  // These three interact, so they are validated together against the resulting
  // state of the row rather than field by field. A partial update ("just change
  // the link") must be judged against the kind the product ALREADY has, so read
  // the current row whenever any of them is present.
  const touchesFulfilment =
    body?.kind !== undefined ||
    body?.fulfilment_url !== undefined ||
    body?.fulfilment_notes !== undefined;
  if (touchesFulfilment) {
    if (body?.kind !== undefined) {
      if (body.kind !== 'physical' && body.kind !== 'elearning') {
        return jsonResponse(
          { error: "kind must be 'physical' or 'elearning'", request_id: requestId },
          400,
        );
      }
      patch.kind = body.kind;
    }
    // Access links are HQ's to set; a franchisee's own e-learning is fulfilled
    // by hand, so the field is silently ignored for them rather than erroring
    // on a form that never showed it.
    if (body?.fulfilment_url !== undefined && isHq) {
      const url =
        typeof body.fulfilment_url === 'string' && body.fulfilment_url.trim()
          ? body.fulfilment_url.trim()
          : null;
      if (url && (!isHttpsUrl(url) || url.length > 2000)) {
        return jsonResponse(
          { error: 'fulfilment_url must be a valid https:// link', request_id: requestId },
          400,
        );
      }
      patch.fulfilment_url = url;
    }
    if (body?.fulfilment_notes !== undefined) {
      patch.fulfilment_notes =
        typeof body.fulfilment_notes === 'string' && body.fulfilment_notes.trim()
          ? body.fulfilment_notes.trim().slice(0, 1000)
          : null;
    }

    // The link is required against the kind the row will END UP as — whether
    // that is a kind being set now or the one already on the row — so an HQ
    // e-learning item can never be left with nothing to deliver. This does NOT
    // apply to a franchisee's own item: theirs is fulfilled by hand and the
    // confirmation email says access follows separately, so no link is right.
    const resultingKind = patch.kind !== undefined ? patch.kind : current.kind;
    const resultingUrl =
      patch.fulfilment_url !== undefined ? patch.fulfilment_url : current.fulfilment_url;
    if (isHq && resultingKind === 'elearning' && !resultingUrl) {
      return jsonResponse(
        {
          error: 'fulfilment_url is required for an e-learning course (where buyers get access)',
          request_id: requestId,
        },
        400,
      );
    }
  }

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ error: 'Nothing to update', request_id: requestId }, 400);
  }

  // Belt and braces: a non-HQ caller's UPDATE is additionally scoped to rows
  // they own, so the ownership check above can never be the only thing standing
  // between a franchisee and an HQ network item.
  let updQuery = admin.from('da_products').update(patch).eq('id', productId);
  if (!isHq) updQuery = updQuery.eq('franchisee_id', callerId);
  const upd = await updQuery.select('*').maybeSingle();
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
      actor_type: isHq ? 'hq' : 'franchisee',
      actor_id: callerId,
      entity_type: 'product',
      entity_id: productId,
      action: 'product_updated',
      metadata: { changes: patch, franchisee_id: ownerId },
      description: isHq
        ? `Product updated: ${(upd.data as any).name}`
        : `${(caller.data as any).name} updated their own item: ${(upd.data as any).name}`,
    })
    .then((r: { error: unknown }) => {
      if (r.error) console.error('product_updated activity insert failed', r.error);
    });

  return jsonResponse(upd.data, 200);
});

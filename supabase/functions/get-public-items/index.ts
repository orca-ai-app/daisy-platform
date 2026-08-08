// supabase/functions/get-public-items/index.ts
//
// PUBLIC (no auth) — the booking widget's read API for SELLABLE ITEMS: undated
// products a franchisee sells online (books, kits, and e-learning courses).
// Migration 044. The item counterpart to get-public-courses: courses are dated
// events, items are always available.
//
// POST {
//   franchisee_id?: string,   // internal UUID or the human number ("0042")
//   postcode?: string         // resolve the territory owner instead
// }
// -> { items: Array<{
//        id,             // da_franchisee_products.id — pass to create-checkout-session
//        product_id, name, description, kind,
//        price_pence, vat_rate,
//        franchisee_id, franchisee_name
//      }> }
//
// Only rows the franchisee has switched online (is_online) whose catalogue
// product is still active are returned. Given a postcode and no franchisee, the
// territory owner is resolved the same way get-public-courses does (postcode
// prefix -> da_territories -> franchisee); a vacant/unknown territory returns an
// empty array rather than another franchisee's items. Best-effort per-IP rate
// limit (20/min) per PRD §12.5, matching get-public-courses.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function postcodePrefix(postcode: string): string {
  const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '');
  if (cleaned.length < 5) return cleaned;
  return cleaned.slice(0, cleaned.length - 3);
}

// --- Best-effort per-isolate rate limit (PRD §12.5: 20 req/min/IP) -----------
const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

interface RequestBody {
  franchisee_id?: unknown;
  postcode?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    'unknown';
  if (rateLimited(ip)) {
    return jsonResponse({ error: 'Too many requests. Please slow down.' }, 429);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // --- Resolve the franchisee whose items we list ---------------------------
  // franchisee_id accepts EITHER the internal UUID or the human franchisee
  // number ("0042") — the WordPress embeds use the number, so resolve it.
  let franchiseeId = typeof body.franchisee_id === 'string' ? body.franchisee_id.trim() : '';
  if (franchiseeId && !UUID_RE.test(franchiseeId)) {
    const byNumber = await admin
      .from('da_franchisees')
      .select('id')
      .eq('number', franchiseeId)
      .maybeSingle();
    // Unknown number → keep the unmatchable string so the filter returns
    // nothing (never silently fall back to ALL franchisees' items).
    franchiseeId = (byNumber.data as any)?.id ?? franchiseeId;
  }

  if (!franchiseeId) {
    const postcode = typeof body.postcode === 'string' ? body.postcode.trim() : '';
    if (!postcode) {
      return jsonResponse({ error: 'franchisee_id or postcode is required' }, 400);
    }
    if (!UK_POSTCODE_RE.test(postcode)) {
      return jsonResponse({ error: 'A valid UK postcode is required' }, 400);
    }
    const territory = await admin
      .from('da_territories')
      .select('franchisee_id, status')
      .eq('postcode_prefix', postcodePrefix(postcode))
      .maybeSingle();
    if (territory.error) {
      console.error('territory lookup failed', territory.error);
      return jsonResponse({ error: 'Could not look up that postcode right now' }, 500);
    }
    const owner = (territory.data as any)?.franchisee_id ?? null;
    // Vacant or unknown territory — no items rather than someone else's.
    if (!owner) return jsonResponse({ items: [] }, 200);
    franchiseeId = owner;
  }

  // --- Listed items ----------------------------------------------------------
  const listed = await admin
    .from('da_franchisee_products')
    .select(
      `id, product_id, price_pence, vat_rate, franchisee_id,
       product:da_products ( name, description, kind, active, sort_order ),
       franchisee:da_franchisees ( name )`,
    )
    .eq('franchisee_id', franchiseeId)
    .eq('is_online', true);
  if (listed.error) {
    console.error('franchisee products lookup failed', listed.error);
    return jsonResponse({ error: 'Could not load items right now' }, 500);
  }

  const items = ((listed.data ?? []) as any[])
    // The catalogue product must still be active — HQ deactivating a product
    // pulls it from every franchisee's shop without touching their rows.
    .filter((r) => r.product?.active === true)
    .sort(
      (a, b) =>
        (a.product?.sort_order ?? 0) - (b.product?.sort_order ?? 0) ||
        String(a.product?.name ?? '').localeCompare(String(b.product?.name ?? '')),
    )
    .map((r) => ({
      id: r.id,
      product_id: r.product_id,
      name: r.product?.name ?? '',
      description: r.product?.description ?? null,
      kind: r.product?.kind ?? 'physical',
      price_pence: r.price_pence,
      vat_rate: r.vat_rate,
      franchisee_id: r.franchisee_id,
      franchisee_name: r.franchisee?.name ?? null,
    }));

  return jsonResponse({ items }, 200);
});

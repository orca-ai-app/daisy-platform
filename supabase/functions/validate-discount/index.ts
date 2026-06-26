// supabase/functions/validate-discount/index.ts
//
// PUBLIC (no auth) — the booking widget's live discount check. PRD §4.12.
//
// POST {
//   code: string,
//   course_instance_id?: string,   // to scope the check to the course's franchisee
//   amount_pence?: number          // pre-discount total, to compute the saving
// }
// -> { valid: true, code, type, value, amount_off_pence?, reason: null }
//    | { valid: false, reason: string }
//
// A code is valid when: it exists, is_active, within its valid_from/valid_until
// window, under max_uses, and — if it's a per-franchisee code — belongs to the
// franchisee running the course. This is a READ-ONLY check: it does NOT
// increment uses_count (that happens at booking confirmation in the webhook).

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

function invalid(reason: string): Response {
  // 200 with valid:false — an unusable code is an expected outcome, not an error.
  return jsonResponse({ valid: false, reason }, 200);
}

const RATE_LIMIT = 30;
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
  code?: unknown;
  course_instance_id?: unknown;
  amount_pence?: unknown;
}

export function computeAmountOff(
  type: 'percentage' | 'fixed',
  value: number,
  amountPence: number,
): number {
  if (amountPence <= 0) return 0;
  if (type === 'percentage') return Math.min(amountPence, Math.floor((amountPence * value) / 100));
  return Math.min(amountPence, value);
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

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) return jsonResponse({ error: 'code is required' }, 400);

  const row = await admin
    .from('da_discount_codes')
    .select(
      'id, code, franchisee_id, type, value, max_uses, uses_count, valid_from, valid_until, is_active',
    )
    .eq('code', code)
    .maybeSingle();

  if (row.error) {
    console.error('discount lookup failed', row.error);
    return jsonResponse({ error: 'Could not check that code right now' }, 500);
  }
  const d = row.data as any;
  if (!d) return invalid('That code was not recognised.');
  if (!d.is_active) return invalid('That code is no longer active.');

  const now = Date.now();
  if (d.valid_from && new Date(d.valid_from).getTime() > now) {
    return invalid('That code is not valid yet.');
  }
  if (d.valid_until && new Date(d.valid_until).getTime() < now) {
    return invalid('That code has expired.');
  }
  if (d.max_uses != null && d.uses_count >= d.max_uses) {
    return invalid('That code has reached its usage limit.');
  }

  // Per-franchisee codes only apply to that franchisee's courses.
  const courseInstanceId =
    typeof body.course_instance_id === 'string' ? body.course_instance_id : null;
  if (d.franchisee_id && courseInstanceId) {
    const inst = await admin
      .from('da_course_instances')
      .select('franchisee_id')
      .eq('id', courseInstanceId)
      .maybeSingle();
    if (inst.data && (inst.data as any).franchisee_id !== d.franchisee_id) {
      return invalid('That code cannot be used for this course.');
    }
  }

  const amountPence =
    typeof body.amount_pence === 'number' && body.amount_pence > 0 ? body.amount_pence : 0;
  const amountOff = computeAmountOff(d.type, d.value, amountPence);

  return jsonResponse(
    {
      valid: true,
      reason: null,
      code: d.code,
      type: d.type,
      value: d.value,
      amount_off_pence: amountPence > 0 ? amountOff : undefined,
    },
    200,
  );
});

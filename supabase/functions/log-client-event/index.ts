// supabase/functions/log-client-event/index.ts
//
// PUBLIC (verify_jwt=false) — ingests browser error/warn events from the
// three frontends (portal, booking widget, medical form) into da_system_logs,
// so a parent's 8pm booking failure is visible on /hq/system-logs without
// anyone asking them to open DevTools.
//
// POST { events: [{ level, source, message, request_id?, context? }, ...] }
//   -> 200 { ok: true, accepted }
//
// Abuse controls (public endpoint):
//   - strict shape: source must be browser:portal|booking|medical,
//     level warn|error only, max 5 events per call
//   - message capped 500 chars, context JSON capped ~2KB
//   - per-IP token bucket: max 20 events/hour (in-memory per isolate — an
//     approximation, good enough to stop loops/abuse, not a hard guarantee)

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

const ALLOWED_SOURCES = new Set(['browser:portal', 'browser:booking', 'browser:medical']);
const ALLOWED_LEVELS = new Set(['warn', 'error']);
const MAX_EVENTS_PER_CALL = 5;
const MAX_PER_IP_PER_HOUR = 20;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();

function allowIp(ip: string, events: number): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: events, resetAt: now + 3_600_000 });
    return true;
  }
  if (bucket.count + events > MAX_PER_IP_PER_HOUR) return false;
  bucket.count += events;
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS_PER_CALL) : [];
  if (events.length === 0) return jsonResponse({ ok: true, accepted: 0 }, 200);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown';
  if (!allowIp(ip, events.length)) return jsonResponse({ error: 'Rate limited' }, 429);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const rows = [];
  for (const e of events) {
    if (!ALLOWED_SOURCES.has(e?.source) || !ALLOWED_LEVELS.has(e?.level)) continue;
    if (typeof e?.message !== 'string' || e.message.length === 0) continue;
    let context: Record<string, unknown> | null = null;
    if (e?.context && typeof e.context === 'object') {
      const s = JSON.stringify(e.context);
      context = s.length <= 2048 ? e.context : { truncated: s.slice(0, 2048) };
    }
    rows.push({
      level: e.level,
      source: e.source,
      request_id: typeof e?.request_id === 'string' ? e.request_id.slice(0, 16) : null,
      actor: typeof e?.actor === 'string' ? e.actor.slice(0, 64) : 'public',
      message: e.message.slice(0, 500),
      context,
    });
  }
  if (rows.length === 0) return jsonResponse({ ok: true, accepted: 0 }, 200);

  const insert = await admin.from('da_system_logs').insert(rows);
  if (insert.error) {
    console.error('log-client-event insert failed', insert.error);
    return jsonResponse({ error: 'Insert failed' }, 500);
  }
  return jsonResponse({ ok: true, accepted: rows.length }, 200);
});

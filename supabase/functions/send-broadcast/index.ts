// supabase/functions/send-broadcast/index.ts
//
// HQ-ONLY (JWT verified) — drives one-off broadcast emails composed in the
// portal (da_email_broadcasts). Actions:
//
//   POST { action: 'preview_count', audience_type, audience_config }
//        -> 200 { eligible, suppressed, to_send }
//   POST { action: 'send_now', broadcast_id }        -> 200 { ok, sent, failed, skipped }
//   POST { action: 'schedule', broadcast_id }        -> 200 { ok: true }  (row must have scheduled_for)
//   POST { action: 'cancel_schedule', broadcast_id } -> 200 { ok: true }  (scheduled -> draft)
//
// Scheduled broadcasts are drained by the hourly send-emails cron via the
// shared _shared/broadcastSender.ts.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { previewAudience, processBroadcast } from '../_shared/broadcastSender.ts';

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

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) return jsonResponse({ error: 'Invalid JWT' }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const fromEmail = Deno.env.get('POSTMARK_FROM_EMAIL') ?? 'bookings@team.daisyfirstaid.com';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // --- HQ gate --------------------------------------------------------------
  const caller = await admin
    .from('da_franchisees')
    .select('id, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error) {
    console.error('caller lookup failed', caller.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'HQ access required' }, 403);
  }

  try {
    switch (body?.action) {
      case 'preview_count': {
        if (!body.audience_type) return jsonResponse({ error: 'audience_type is required' }, 400);
        const counts = await previewAudience(admin, body.audience_type, body.audience_config ?? {});
        return jsonResponse(counts, 200);
      }
      case 'send_now': {
        if (!body.broadcast_id) return jsonResponse({ error: 'broadcast_id is required' }, 400);
        if (!postmarkToken) return jsonResponse({ error: 'POSTMARK_SERVER_TOKEN not set' }, 500);
        const result = await processBroadcast(admin, postmarkToken, fromEmail, body.broadcast_id);
        return jsonResponse({ ok: true, ...result }, 200);
      }
      case 'schedule': {
        if (!body.broadcast_id) return jsonResponse({ error: 'broadcast_id is required' }, 400);
        const b = await admin
          .from('da_email_broadcasts')
          .select('status, scheduled_for')
          .eq('id', body.broadcast_id)
          .maybeSingle();
        if (b.error || !b.data) return jsonResponse({ error: 'Broadcast not found' }, 404);
        if ((b.data as any).status !== 'draft') {
          return jsonResponse(
            { error: `Cannot schedule a ${(b.data as any).status} broadcast` },
            400,
          );
        }
        const when = (b.data as any).scheduled_for;
        if (!when || new Date(when).getTime() <= Date.now()) {
          return jsonResponse({ error: 'scheduled_for must be set and in the future' }, 400);
        }
        await admin
          .from('da_email_broadcasts')
          .update({ status: 'scheduled' })
          .eq('id', body.broadcast_id);
        return jsonResponse({ ok: true }, 200);
      }
      case 'cancel_schedule': {
        if (!body.broadcast_id) return jsonResponse({ error: 'broadcast_id is required' }, 400);
        const upd = await admin
          .from('da_email_broadcasts')
          .update({ status: 'draft' })
          .eq('id', body.broadcast_id)
          .eq('status', 'scheduled')
          .select('id');
        if (upd.error) return jsonResponse({ error: 'Update failed' }, 500);
        if (!upd.data || upd.data.length === 0) {
          return jsonResponse({ error: 'Broadcast is not scheduled' }, 400);
        }
        return jsonResponse({ ok: true }, 200);
      }
      default:
        return jsonResponse({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    console.error('send-broadcast failed', err);
    return jsonResponse({ error: String(err).slice(0, 300) }, 500);
  }
});

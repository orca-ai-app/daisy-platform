// supabase/functions/send-test-email/index.ts
//
// HQ-ONLY (JWT verified) — sends one email template to the logged-in HQ user
// with sample merge data, so template edits can be checked in a real inbox
// before customers see them. Called by the "Send me a test" button in the
// portal's email editor.
//
// POST { template_key: string }                      -> 200 { ok: true, sent_to }
// POST { subject, preheader?, blocks: EmailBlock[] } -> 200 { ok: true, sent_to }
//
// The first form renders the CURRENT da_email_templates row; the second
// renders an inline draft (used by the broadcast composer before saving).
// No queue row is written and no Metadata is attached, so tests never
// pollute the analytics.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  renderBlocks,
  fillMerge,
  type EmailBlock,
  type RenderContext,
} from '../_shared/emailBlocks.ts';

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

const SAMPLE_CTX: RenderContext = {
  first_name: 'Sophie',
  customer_name: 'Sophie Taylor',
  template_name: 'Baby & Child First Aid Class',
  event_date: 'Saturday 12 September 2026',
  start_time: '10:00',
  venue: "St Mary's Community Hall",
  franchisee_name: 'Jenni',
  franchisee_email: 'jenni@daisyfirstaid.com',
  booking_reference: 'DFA-SAMPLE',
  unsubscribe_url: 'https://www.daisyfirstaid.com',
};

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
  const templateKey = typeof body?.template_key === 'string' ? body.template_key : '';
  const inlineBlocks = Array.isArray(body?.blocks) ? (body.blocks as EmailBlock[]) : null;
  if (!templateKey && !inlineBlocks) {
    return jsonResponse({ error: 'template_key or blocks is required' }, 400);
  }
  if (inlineBlocks && typeof body?.subject !== 'string') {
    return jsonResponse({ error: 'subject is required with blocks' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const fromEmail = Deno.env.get('POSTMARK_FROM_EMAIL') ?? 'bookings@team.daisyfirstaid.com';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  if (!postmarkToken) return jsonResponse({ error: 'POSTMARK_SERVER_TOKEN not set' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // --- HQ gate --------------------------------------------------------------
  const caller = await admin
    .from('da_franchisees')
    .select('id, name, email, is_hq')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (caller.error) {
    console.error('caller lookup failed', caller.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!caller.data || !(caller.data as any).is_hq) {
    return jsonResponse({ error: 'HQ access required' }, 403);
  }
  const recipient = (caller.data as any).email as string;
  if (!recipient) return jsonResponse({ error: 'Your account has no email address' }, 400);

  let t: { subject: string; preheader: string | null; blocks: EmailBlock[] };
  if (inlineBlocks) {
    t = {
      subject: body.subject as string,
      preheader: typeof body?.preheader === 'string' ? body.preheader : null,
      blocks: inlineBlocks,
    };
  } else {
    const template = await admin
      .from('da_email_templates')
      .select('subject, preheader, blocks')
      .eq('template_key', templateKey)
      .maybeSingle();
    if (template.error || !template.data) {
      return jsonResponse({ error: `No template found for ${templateKey}` }, 404);
    }
    t = template.data as any;
  }

  const rendered = renderBlocks(
    (t.blocks ?? []) as EmailBlock[],
    SAMPLE_CTX,
    t.preheader ?? undefined,
  );
  const subject = `[TEST] ${fillMerge(t.subject, SAMPLE_CTX)}`;

  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': postmarkToken,
    },
    body: JSON.stringify({
      From: fromEmail,
      To: recipient,
      Subject: subject,
      HtmlBody: rendered.html,
      TextBody: rendered.text,
      MessageStream: 'outbound',
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    console.error('send-test-email: Postmark failed', res.status, errBody.slice(0, 300));
    return jsonResponse({ error: `Postmark ${res.status}: ${errBody.slice(0, 200)}` }, 502);
  }

  return jsonResponse({ ok: true, sent_to: recipient }, 200);
});

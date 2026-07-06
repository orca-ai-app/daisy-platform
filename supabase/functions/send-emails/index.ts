// supabase/functions/send-emails/index.ts
//
// CRON — drains due da_email_sequences rows and sends them via Postmark. PRD §5.6.
// Scheduled hourly by pg_cron (migration 029) which calls this URL via pg_net
// with Authorization: Bearer <CRON_SECRET>.
//
// POST {} (Bearer CRON_SECRET) -> { processed, sent, failed }
//
// For each pending row due now: load booking + customer + course + franchisee,
// render the template — da_email_templates row (HQ-editable blocks, migrations
// 030/031) when one exists, else the code fallback in templates.ts — and POST
// to Postmark with open tracking + a signed List-Unsubscribe. Marketing rows
// for opted-out customers are cancelled, not sent. Success → status='sent'
// (+ provider_message_id for webhook correlation); failure → status='failed'
// + activity row (HQ resends manually — no auto retry).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { renderTemplate, type TemplateContext } from './templates.ts';
import { renderBlocks, fillMerge, type EmailBlock } from '../_shared/emailBlocks.ts';
import { buildUnsubscribeUrl } from '../_shared/unsubscribeToken.ts';
import { processBroadcast } from '../_shared/broadcastSender.ts';

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

function formatDate(d: string | null): string {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, day)));
  } catch {
    return d;
  }
}

async function sendViaPostmark(
  token: string,
  from: string,
  to: string,
  replyTo: string | null,
  subject: string,
  html: string,
  text: string,
  metadata?: Record<string, string>,
  unsubscribeUrl?: string,
  messageStream = 'outbound',
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        ReplyTo: replyTo ?? undefined,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        TrackOpens: true,
        Metadata: metadata,
        Headers: unsubscribeUrl
          ? [{ Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` }]
          : undefined,
        // Marketing (journey) mail goes on the 'broadcasts' stream per Postmark
        // policy; transactional stays on 'outbound'.
        MessageStream: messageStream,
      }),
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { MessageID?: string };
      return { ok: true, messageId: body.MessageID };
    }
    const body = await res.text();
    return { ok: false, error: `Postmark ${res.status}: ${body.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice('bearer '.length).trim()
    : '';
  if (!cronSecret || token !== cronSecret) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const postmarkToken = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const fromEmail = Deno.env.get('POSTMARK_FROM_EMAIL') ?? 'bookings@team.daisyfirstaid.com';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server misconfigured' }, 500);
  if (!postmarkToken) return jsonResponse({ error: 'POSTMARK_SERVER_TOKEN not set' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const due = await admin
    .from('da_email_sequences')
    .select('id, template_key, customer_id, booking_id')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(100);
  if (due.error) {
    console.error('send-emails: select failed', due.error);
    return jsonResponse({ error: 'Could not load the queue' }, 500);
  }
  const rows = (due.data ?? []) as any[];

  // HQ-editable templates (migrations 030/031) — one load per invocation.
  // Keys without a row fall back to the code templates in templates.ts.
  const templatesRes = await admin
    .from('da_email_templates')
    .select('template_key, subject, preheader, blocks, is_marketing');
  if (templatesRes.error) {
    console.error('send-emails: template load failed', templatesRes.error);
    return jsonResponse({ error: 'Could not load templates' }, 500);
  }
  const dbTemplates = new Map<string, any>(
    (templatesRes.data ?? []).map((t: any) => [t.template_key, t]),
  );

  // Global opt-out set (da_email_suppressions) — checked for marketing sends
  // alongside the per-customer flag (covers unsubs that came in via list links
  // or spam complaints before the customer row existed).
  const suppressionsRes = await admin.from('da_email_suppressions').select('email');
  if (suppressionsRes.error) {
    console.error('send-emails: suppression load failed', suppressionsRes.error);
    return jsonResponse({ error: 'Could not load suppressions' }, 500);
  }
  const suppressed = new Set<string>(
    (suppressionsRes.data ?? []).map((r: any) => (r.email as string).toLowerCase()),
  );

  let sent = 0;
  let failed = 0;
  let cancelled = 0;

  for (const row of rows) {
    try {
      // Load booking → customer, course instance + template, franchisee.
      const booking = await admin
        .from('da_bookings')
        .select(
          `booking_reference,
           customer:da_customers ( first_name, last_name, email, marketing_opt_out ),
           course_instance:da_course_instances (
             event_date, start_time, venue_name, venue_postcode,
             template:da_course_templates ( name )
           ),
           franchisee:da_franchisees ( name, email )`,
        )
        .eq('id', row.booking_id)
        .maybeSingle();
      if (booking.error || !booking.data) throw new Error('booking load failed');
      const b = booking.data as any;

      // new_booking_notification goes to the franchisee; everything else to the customer.
      const toFranchisee = row.template_key === 'new_booking_notification';
      const recipient = toFranchisee ? b.franchisee?.email : b.customer?.email;
      if (!recipient) throw new Error('no recipient email');

      const dbTemplate = dbTemplates.get(row.template_key);

      // Suppression: opted-out customers get no marketing emails. Their queued
      // marketing rows are cancelled (not failed); transactional still sends.
      // Keys without a DB row are the transactional set — never suppressed.
      if (
        !toFranchisee &&
        dbTemplate?.is_marketing &&
        (b.customer?.marketing_opt_out || suppressed.has(recipient.toLowerCase()))
      ) {
        await admin.from('da_email_sequences').update({ status: 'cancelled' }).eq('id', row.id);
        cancelled++;
        continue;
      }

      const ctx: TemplateContext = {
        first_name: b.customer?.first_name ?? 'there',
        customer_name: `${b.customer?.first_name ?? ''} ${b.customer?.last_name ?? ''}`.trim(),
        template_name: b.course_instance?.template?.name ?? 'your class',
        event_date: formatDate(b.course_instance?.event_date ?? null),
        start_time: (b.course_instance?.start_time ?? '').slice(0, 5),
        venue: b.course_instance?.venue_name ?? b.course_instance?.venue_postcode ?? '',
        franchisee_name: b.franchisee?.name ?? 'Daisy First Aid',
        franchisee_email: b.franchisee?.email ?? '',
        booking_reference: b.booking_reference,
        unsubscribe_url: await buildUnsubscribeUrl(row.customer_id),
      };

      let tmpl: { subject: string; html: string; text: string } | null;
      if (dbTemplate) {
        const rendered = renderBlocks(
          (dbTemplate.blocks ?? []) as EmailBlock[],
          ctx,
          dbTemplate.preheader ?? undefined,
        );
        tmpl = { subject: fillMerge(dbTemplate.subject, ctx), ...rendered };
      } else {
        tmpl = renderTemplate(row.template_key, ctx);
      }
      if (!tmpl) throw new Error(`no template for key ${row.template_key}`);

      const replyTo = toFranchisee ? null : (b.franchisee?.email ?? null);
      const result = await sendViaPostmark(
        postmarkToken,
        fromEmail,
        recipient,
        replyTo,
        tmpl.subject,
        tmpl.html,
        tmpl.text,
        { sequence_id: row.id, template_key: row.template_key },
        ctx.unsubscribe_url,
        dbTemplate?.is_marketing ? 'broadcasts' : 'outbound',
      );

      if (result.ok) {
        await admin
          .from('da_email_sequences')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            provider_message_id: result.messageId ?? null,
          })
          .eq('id', row.id);
        sent++;
      } else {
        throw new Error(result.error ?? 'Postmark send failed');
      }
    } catch (err) {
      failed++;
      await admin.from('da_email_sequences').update({ status: 'failed' }).eq('id', row.id);
      await admin
        .from('da_activities')
        .insert({
          actor_type: 'system',
          actor_id: null,
          entity_type: 'email_sequence',
          entity_id: row.id,
          action: 'email_failed',
          metadata: { template_key: row.template_key, error: String(err).slice(0, 300) },
          description: `Email ${row.template_key} failed to send`,
        })
        .then((r: { error: unknown }) => {
          if (r.error) console.error('email_failed activity insert failed', r.error);
        });
    }
  }

  // --- One-off broadcasts: drain due scheduled ones + resume any stuck run ---
  // (status 'sending' with no progress for 10+ minutes = a crashed/timed-out
  // invocation; processBroadcast only touches 'pending' recipients, so
  // resuming is safe).
  let broadcastsProcessed = 0;
  const dueBroadcasts = await admin
    .from('da_email_broadcasts')
    .select('id, status, scheduled_for, updated_at')
    .or(
      `and(status.eq.scheduled,scheduled_for.lte.${new Date().toISOString()}),` +
        `and(status.eq.sending,updated_at.lt.${new Date(Date.now() - 10 * 60 * 1000).toISOString()})`,
    );
  if (dueBroadcasts.error) {
    console.error('send-emails: broadcast select failed', dueBroadcasts.error);
  } else {
    for (const b of (dueBroadcasts.data ?? []) as any[]) {
      try {
        await processBroadcast(admin, postmarkToken, fromEmail, b.id);
        broadcastsProcessed++;
      } catch (err) {
        console.error(`send-emails: broadcast ${b.id} failed`, err);
        await admin
          .from('da_activities')
          .insert({
            actor_type: 'system',
            actor_id: null,
            entity_type: 'email_broadcast',
            entity_id: b.id,
            action: 'broadcast_failed',
            metadata: { error: String(err).slice(0, 300) },
            description: 'Scheduled broadcast failed to send',
          })
          .then((r: { error: unknown }) => {
            if (r.error) console.error('broadcast_failed activity insert failed', r.error);
          });
      }
    }
  }

  return jsonResponse(
    { processed: rows.length, sent, failed, cancelled, broadcasts: broadcastsProcessed },
    200,
  );
});

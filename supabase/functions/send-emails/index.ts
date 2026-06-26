// supabase/functions/send-emails/index.ts
//
// CRON — drains due da_email_sequences rows and sends them via Postmark. PRD §5.6.
// Scheduled hourly by pg_cron (migration 029) which calls this URL via pg_net
// with Authorization: Bearer <CRON_SECRET>.
//
// POST {} (Bearer CRON_SECRET) -> { processed, sent, failed }
//
// For each pending row due now: load booking + customer + course + franchisee,
// render the template (templates.ts), POST to Postmark. Success → status='sent';
// failure → status='failed' + activity row (HQ resends manually — no auto retry).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { renderTemplate, type TemplateContext } from './templates.ts';

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

const BOOKING_BASE = Deno.env.get('BOOKING_BASE_URL') ?? 'https://booking.daisyfirstaid.com';

async function sendViaPostmark(
  token: string,
  from: string,
  to: string,
  replyTo: string | null,
  subject: string,
  html: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
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
        MessageStream: 'outbound',
      }),
    });
    if (res.ok) return { ok: true };
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

  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Load booking → customer, course instance + template, franchisee.
      const booking = await admin
        .from('da_bookings')
        .select(
          `booking_reference,
           customer:da_customers ( first_name, last_name, email ),
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
        unsubscribe_url: `${BOOKING_BASE}/unsubscribe?email=${encodeURIComponent(recipient)}`,
      };

      const tmpl = renderTemplate(row.template_key, ctx);
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
      );

      if (result.ok) {
        await admin
          .from('da_email_sequences')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
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

  return jsonResponse({ processed: rows.length, sent, failed }, 200);
});

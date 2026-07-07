// supabase/functions/postmark-webhook/index.ts
//
// Postmark event webhook (Kartra migration) — Delivery, Open, Bounce and
// SpamComplaint events land here and become da_email_events rows for the HQ
// analytics page. First Open also stamps da_email_sequences.opened_at; a spam
// complaint additionally opts the customer out of marketing.
//
// Auth: verify_jwt=false (Postmark's servers call this); gated by a shared
// secret in the URL, configured in Postmark as
//   https://<ref>.supabase.co/functions/v1/postmark-webhook?secret=<POSTMARK_WEBHOOK_SECRET>
// Events correlate via Metadata.sequence_id, set by send-emails at send time.
// Cutover: configure the webhook (Delivery/Open/Bounce/SpamComplaint) + open
// tracking on the production Postmark server — docs/M3-cutover-checklist.md.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { logSystem } from '../_shared/log.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EVENT_TYPES: Record<string, string> = {
  Delivery: 'delivered',
  Open: 'opened',
  Bounce: 'bounced',
  SpamComplaint: 'spam_complaint',
};

// The 'broadcasts' stream uses Postmark-managed unsubscribe handling (Custom
// handling is support-gated), so Postmark injects its own unsubscribe link and
// keeps its own suppression list. SubscriptionChange events mirror that list
// into da_email_suppressions so every send path sees one truth.
async function handleSubscriptionChange(admin: any, payload: any): Promise<Response> {
  const email: string | null = payload?.Recipient ?? null;
  if (!email) return json({ ok: true, ignored: 'no recipient' }, 200);
  const emailKey = email.toLowerCase();
  // Non-2xx makes Postmark retry the webhook — desirable when our DB write
  // fails, so the suppression mirror can't silently drift.
  if (payload?.SuppressSending) {
    const source =
      payload?.SuppressionReason === 'SpamComplaint' ? 'spam_complaint' : 'unsubscribe';
    const sup = await admin
      .from('da_email_suppressions')
      .upsert({ email: emailKey, source }, { onConflict: 'email' });
    if (sup.error) {
      await logSystem(admin, {
        level: 'error',
        source: 'postmark-webhook',
        message: `SubscriptionChange suppression upsert failed: ${sup.error.message}`,
      });
      return json({ error: 'suppression write failed' }, 500);
    }
    const flag = await admin
      .from('da_customers')
      .update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() })
      .eq('email', email);
    if (flag.error) {
      await logSystem(admin, {
        level: 'warn',
        source: 'postmark-webhook',
        message: `SubscriptionChange customer flag failed (suppression stored): ${flag.error.message}`,
      });
    }
  } else {
    // Reactivated inside Postmark — lift our suppression too.
    const del = await admin.from('da_email_suppressions').delete().eq('email', emailKey);
    if (del.error) {
      await logSystem(admin, {
        level: 'error',
        source: 'postmark-webhook',
        message: `SubscriptionChange suppression delete failed: ${del.error.message}`,
      });
      return json({ error: 'suppression delete failed' }, 500);
    }
    const flag = await admin
      .from('da_customers')
      .update({ marketing_opt_out: false, marketing_opt_out_at: null })
      .eq('email', email);
    if (flag.error) {
      await logSystem(admin, {
        level: 'warn',
        source: 'postmark-webhook',
        message: `SubscriptionChange customer unflag failed: ${flag.error.message}`,
      });
    }
  }
  return json({ ok: true }, 200);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = Deno.env.get('POSTMARK_WEBHOOK_SECRET') ?? '';
  const given = new URL(req.url).searchParams.get('secret') ?? '';
  if (!secret || given !== secret) return json({ error: 'Forbidden' }, 403);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const supabaseUrlEarly = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKeyEarly = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrlEarly || !serviceRoleKeyEarly)
    return json({ error: 'Server misconfigured' }, 500);

  if (payload?.RecordType === 'SubscriptionChange') {
    const adminEarly = createClient(supabaseUrlEarly, serviceRoleKeyEarly, {
      auth: { persistSession: false },
    });
    return await handleSubscriptionChange(adminEarly, payload);
  }

  const eventType = EVENT_TYPES[payload?.RecordType ?? ''];
  if (!eventType) return json({ ok: true, ignored: payload?.RecordType ?? 'unknown' }, 200);

  const sequenceId: string | null = payload?.Metadata?.sequence_id ?? null;
  // Short key: Postmark metadata field names are capped at 20 characters.
  const broadcastRecipientId: string | null = payload?.Metadata?.bcast_recipient_id ?? null;
  const templateKey: string = payload?.Metadata?.template_key ?? payload?.Tag ?? 'broadcast';
  const occurredAt: string =
    payload?.ReceivedAt ?? payload?.DeliveredAt ?? payload?.BouncedAt ?? new Date().toISOString();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Server misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const insert = await admin.from('da_email_events').insert({
    sequence_id: sequenceId,
    broadcast_recipient_id: broadcastRecipientId,
    template_key: templateKey,
    event_type: eventType,
    occurred_at: occurredAt,
    // Keep the useful fields, not the whole body (payload can carry the
    // recipient's UA/geo on opens — no need to retain that).
    payload: {
      message_id: payload?.MessageID ?? null,
      recipient: payload?.Recipient ?? payload?.Email ?? null,
      bounce_type: payload?.Type ?? null,
      first_open: payload?.FirstOpen ?? null,
    },
  });
  if (insert.error) {
    console.error('postmark-webhook: event insert failed', insert.error);
    return json({ error: 'Insert failed' }, 500);
  }

  if (eventType === 'opened') {
    // First open only — don't move the timestamp on re-opens.
    if (sequenceId) {
      const upd = await admin
        .from('da_email_sequences')
        .update({ opened_at: occurredAt })
        .eq('id', sequenceId)
        .is('opened_at', null);
      if (upd.error) {
        await logSystem(admin, {
          level: 'warn',
          source: 'postmark-webhook',
          message: `opened_at update failed for sequence ${sequenceId}: ${upd.error.message}`,
        });
      }
    }
    if (broadcastRecipientId) {
      const upd = await admin
        .from('da_email_broadcast_recipients')
        .update({ opened_at: occurredAt })
        .eq('id', broadcastRecipientId)
        .is('opened_at', null);
      if (upd.error) {
        await logSystem(admin, {
          level: 'warn',
          source: 'postmark-webhook',
          message: `opened_at update failed for broadcast recipient ${broadcastRecipientId}: ${upd.error.message}`,
        });
      }
    }
  }

  if (eventType === 'spam_complaint') {
    // Global suppression by the complaining address, plus the customer flag
    // when the send is traceable to a customer.
    const complainant: string | null = payload?.Recipient ?? payload?.Email ?? null;
    if (complainant) {
      const sup = await admin
        .from('da_email_suppressions')
        .upsert(
          { email: complainant.toLowerCase(), source: 'spam_complaint' },
          { onConflict: 'email' },
        );
      if (sup.error) {
        // A failed spam-complaint suppression means we keep emailing someone
        // who reported us as spam — fail the webhook so Postmark retries.
        await logSystem(admin, {
          level: 'error',
          source: 'postmark-webhook',
          message: `spam-complaint suppression upsert failed: ${sup.error.message}`,
        });
        return json({ error: 'suppression write failed' }, 500);
      }
    }
    if (sequenceId) {
      const seq = await admin
        .from('da_email_sequences')
        .select('customer_id')
        .eq('id', sequenceId)
        .maybeSingle();
      const customerId = (seq.data as any)?.customer_id;
      if (customerId) {
        await admin
          .from('da_customers')
          .update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() })
          .eq('id', customerId);
        await admin.from('da_activities').insert({
          actor_type: 'system',
          actor_id: null,
          entity_type: 'customer',
          entity_id: customerId,
          action: 'marketing_unsubscribed',
          metadata: { via: 'spam_complaint', sequence_id: sequenceId },
          description: 'Customer opted out of marketing (spam complaint)',
        });
      }
    }
  }

  return json({ ok: true }, 200);
});

// Shared broadcast processing for one-off HQ emails (da_email_broadcasts).
// Used by the send-broadcast function (send-now / audience preview) and by
// send-emails (hourly cron drains scheduled broadcasts + resumes stuck ones).
//
// Audiences: opted-in customers (all / by franchisee), franchisees (all
// active / selected), or a CSV-built list. Customer/list sends go on the
// Postmark 'broadcasts' stream with per-recipient unsubscribe links;
// franchisee sends are operational — 'outbound' stream, no unsubscribe.
// Every marketing send is checked against da_email_suppressions (global
// opt-out by email, lowercased).
//
// Recipients are materialised once, then only 'pending' rows are ever sent —
// a crashed or timed-out run resumes from where it stopped.

// deno-lint-ignore-file no-explicit-any

import { renderBlocks, type EmailBlock, type RenderContext } from './emailBlocks.ts';
import { buildUnsubscribeUrl } from './unsubscribeToken.ts';

const BATCH_SIZE = 500; // Postmark /email/batch maximum

export interface AudienceCounts {
  eligible: number;
  suppressed: number;
  to_send: number;
}

interface Candidate {
  email: string;
  first_name: string | null;
  last_name: string | null;
  customer_id?: string;
  franchisee_id?: string;
  list_member_id?: string;
}

function isFranchiseeAudience(audienceType: string): boolean {
  return audienceType === 'franchisees_all' || audienceType === 'franchisees_selected';
}

async function loadCandidates(
  admin: any,
  audienceType: string,
  audienceConfig: any,
): Promise<Candidate[]> {
  switch (audienceType) {
    case 'customers_all': {
      const res = await admin
        .from('da_customers')
        .select('id, email, first_name, last_name')
        .eq('marketing_opt_out', false);
      if (res.error) throw new Error(`customer load failed: ${res.error.message}`);
      return (res.data ?? []).map((c: any) => ({
        email: c.email,
        first_name: c.first_name,
        last_name: c.last_name,
        customer_id: c.id,
      }));
    }
    case 'customers_franchisee': {
      const ids: string[] = audienceConfig?.franchisee_ids ?? [];
      if (ids.length === 0) return [];
      const res = await admin
        .from('da_bookings')
        .select('customer:da_customers ( id, email, first_name, last_name, marketing_opt_out )')
        .in('franchisee_id', ids);
      if (res.error) throw new Error(`franchisee-customer load failed: ${res.error.message}`);
      const out: Candidate[] = [];
      for (const row of res.data ?? []) {
        const c = (row as any).customer;
        if (c && !c.marketing_opt_out) {
          out.push({
            email: c.email,
            first_name: c.first_name,
            last_name: c.last_name,
            customer_id: c.id,
          });
        }
      }
      return out;
    }
    case 'franchisees_all':
    case 'franchisees_selected': {
      let q = admin.from('da_franchisees').select('id, email, name').eq('status', 'active');
      if (audienceType === 'franchisees_selected') {
        const ids: string[] = audienceConfig?.franchisee_ids ?? [];
        if (ids.length === 0) return [];
        q = q.in('id', ids);
      }
      const res = await q;
      if (res.error) throw new Error(`franchisee load failed: ${res.error.message}`);
      return (res.data ?? []).map((f: any) => ({
        email: f.email,
        first_name: f.name,
        last_name: null,
        franchisee_id: f.id,
      }));
    }
    case 'list': {
      const listId = audienceConfig?.list_id;
      if (!listId) return [];
      const res = await admin
        .from('da_email_list_members')
        .select('id, email, first_name, last_name')
        .eq('list_id', listId);
      if (res.error) throw new Error(`list load failed: ${res.error.message}`);
      return (res.data ?? []).map((m: any) => ({
        email: m.email,
        first_name: m.first_name,
        last_name: m.last_name,
        list_member_id: m.id,
      }));
    }
    default:
      throw new Error(`unknown audience_type ${audienceType}`);
  }
}

// Dedupe by lowercased email (first occurrence wins) and split into
// sendable vs suppressed. Franchisee audiences skip the suppression check
// (operational mail).
async function resolveAudience(
  admin: any,
  audienceType: string,
  audienceConfig: any,
): Promise<{ sendable: Candidate[]; suppressed: Candidate[] }> {
  const candidates = await loadCandidates(admin, audienceType, audienceConfig);
  const seen = new Set<string>();
  const deduped: Candidate[] = [];
  for (const c of candidates) {
    const key = (c.email ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...c, email: key });
  }

  if (isFranchiseeAudience(audienceType) || deduped.length === 0) {
    return { sendable: deduped, suppressed: [] };
  }

  const suppressedSet = new Set<string>();
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const chunk = deduped.slice(i, i + BATCH_SIZE).map((c) => c.email);
    const res = await admin.from('da_email_suppressions').select('email').in('email', chunk);
    if (res.error) throw new Error(`suppression check failed: ${res.error.message}`);
    for (const row of res.data ?? []) suppressedSet.add((row as any).email);
  }
  return {
    sendable: deduped.filter((c) => !suppressedSet.has(c.email)),
    suppressed: deduped.filter((c) => suppressedSet.has(c.email)),
  };
}

export async function previewAudience(
  admin: any,
  audienceType: string,
  audienceConfig: any,
): Promise<AudienceCounts> {
  const { sendable, suppressed } = await resolveAudience(admin, audienceType, audienceConfig);
  return {
    eligible: sendable.length + suppressed.length,
    suppressed: suppressed.length,
    to_send: sendable.length,
  };
}

function broadcastCtx(recipient: any, unsubscribeUrl: string): RenderContext {
  return {
    first_name: recipient.first_name || 'there',
    customer_name: `${recipient.first_name ?? ''} ${recipient.last_name ?? ''}`.trim(),
    template_name: '',
    event_date: '',
    start_time: '',
    venue: '',
    franchisee_name: 'Daisy First Aid',
    franchisee_email: '',
    booking_reference: '',
    unsubscribe_url: unsubscribeUrl,
  };
}

export async function processBroadcast(
  admin: any,
  postmarkToken: string,
  fromEmail: string,
  broadcastId: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const bRes = await admin
    .from('da_email_broadcasts')
    .select('id, subject, preheader, blocks, audience_type, audience_config, status')
    .eq('id', broadcastId)
    .maybeSingle();
  if (bRes.error || !bRes.data) throw new Error('broadcast not found');
  const broadcast = bRes.data as any;
  if (!['draft', 'scheduled', 'sending'].includes(broadcast.status)) {
    throw new Error(`broadcast is ${broadcast.status}`);
  }

  const operational = isFranchiseeAudience(broadcast.audience_type);
  await admin.from('da_email_broadcasts').update({ status: 'sending' }).eq('id', broadcastId);

  // Materialise recipients once (re-runs resume the existing rows).
  const countRes = await admin
    .from('da_email_broadcast_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId);
  if (countRes.error) throw new Error(`recipient count failed: ${countRes.error.message}`);
  let skipped = 0;
  if ((countRes.count ?? 0) === 0) {
    const { sendable, suppressed } = await resolveAudience(
      admin,
      broadcast.audience_type,
      broadcast.audience_config,
    );
    skipped = suppressed.length;
    const rows = [
      ...sendable.map((c) => ({ ...c, broadcast_id: broadcastId, status: 'pending' })),
      ...suppressed.map((c) => ({ ...c, broadcast_id: broadcastId, status: 'skipped' })),
    ];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const ins = await admin
        .from('da_email_broadcast_recipients')
        .insert(rows.slice(i, i + BATCH_SIZE));
      if (ins.error) throw new Error(`recipient insert failed: ${ins.error.message}`);
    }
  }

  const stream = operational ? 'outbound' : 'broadcasts';
  const blocks = (broadcast.blocks ?? []) as EmailBlock[];
  let sent = 0;
  let failed = 0;

  for (;;) {
    const page = await admin
      .from('da_email_broadcast_recipients')
      .select('id, email, first_name, last_name, customer_id, list_member_id, broadcast_id')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .limit(BATCH_SIZE);
    if (page.error) throw new Error(`recipient page failed: ${page.error.message}`);
    const recipients = (page.data ?? []) as any[];
    if (recipients.length === 0) break;

    const messages = [];
    for (const r of recipients) {
      let unsubscribeUrl = '';
      if (!operational) {
        unsubscribeUrl = r.customer_id
          ? await buildUnsubscribeUrl(r.customer_id, 'c')
          : r.list_member_id
            ? await buildUnsubscribeUrl(r.list_member_id, 'm')
            : '';
      }
      const ctx = broadcastCtx(r, unsubscribeUrl);
      const rendered = renderBlocks(blocks, ctx, broadcast.preheader ?? undefined, {
        footer: operational ? 'operational' : 'marketing',
      });
      messages.push({
        From: fromEmail,
        To: r.email,
        Subject: broadcast.subject,
        HtmlBody: rendered.html,
        TextBody: rendered.text,
        TrackOpens: true,
        // NB: Postmark metadata field names max 20 chars — hence the short key.
        Metadata: { bcast_recipient_id: r.id },
        Headers:
          !operational && unsubscribeUrl
            ? [{ Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` }]
            : undefined,
        MessageStream: stream,
      });
    }

    const res = await fetch('https://api.postmarkapp.com/email/batch', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': postmarkToken,
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Postmark batch ${res.status}: ${body.slice(0, 200)}`);
    }
    const results = (await res.json()) as any[];

    const now = new Date().toISOString();
    let batchSkipped = 0;
    const errors: string[] = [];
    const updates = recipients.map((r, i) => {
      const code = results[i]?.ErrorCode;
      if (code !== 0 && code !== 406) {
        errors.push(`${r.email}: ${code} ${results[i]?.Message ?? ''}`.slice(0, 200));
      }
      const ok = code === 0;
      // 406 = recipient inactive (on Postmark's own suppression list — the
      // broadcasts stream uses Postmark-managed unsubscribes). Not a failure.
      const suppressedByPostmark = code === 406;
      if (ok) sent++;
      else if (suppressedByPostmark) batchSkipped++;
      else failed++;
      return {
        id: r.id,
        broadcast_id: r.broadcast_id,
        email: r.email,
        status: ok ? 'sent' : suppressedByPostmark ? 'skipped' : 'failed',
        provider_message_id: ok ? (results[i]?.MessageID ?? null) : null,
        sent_at: ok ? now : null,
      };
    });
    skipped += batchSkipped;
    const up = await admin
      .from('da_email_broadcast_recipients')
      .upsert(updates, { onConflict: 'id' });
    if (up.error) throw new Error(`recipient update failed: ${up.error.message}`);

    if (errors.length > 0) {
      console.error(`broadcast ${broadcastId}: ${errors.length} rejected`, errors.slice(0, 5));
      await admin.from('da_activities').insert({
        actor_type: 'system',
        actor_id: null,
        entity_type: 'email_broadcast',
        entity_id: broadcastId,
        action: 'broadcast_sends_rejected',
        metadata: { count: errors.length, sample: errors.slice(0, 5) },
        description: `${errors.length} broadcast send(s) rejected by Postmark`,
      });
    }
  }

  const finalStatus = sent === 0 && failed > 0 ? 'failed' : 'sent';
  await admin
    .from('da_email_broadcasts')
    .update({ status: finalStatus, sent_at: new Date().toISOString() })
    .eq('id', broadcastId);

  return { sent, failed, skipped };
}

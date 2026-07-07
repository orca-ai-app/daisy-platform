// supabase/functions/unsubscribe/index.ts
//
// Public one-click unsubscribe for marketing emails (Kartra migration).
// Linked from every email footer and the List-Unsubscribe header as
//   GET /unsubscribe?c=<id>&t=<HMAC token>                    → opt out (customer)
//   GET /unsubscribe?c=<id>&k=m&t=<HMAC token>                → opt out (CSV list member)
//   GET /unsubscribe?c=...&t=...[&k=m]&action=resubscribe     → opt back in
// The HMAC (see _shared/unsubscribeToken.ts) means a bare email address can
// never unsubscribe someone else. verify_jwt=false (config.toml): recipients
// click this from their inbox with no Supabase session.
//
// Opting out inserts the email into da_email_suppressions (the GLOBAL opt-out
// every marketing send path checks — journey and broadcasts alike). Customers
// additionally get marketing_opt_out set and their pending MARKETING
// da_email_sequences rows cancelled; transactional emails are unaffected.
// Responds with a small branded HTML confirmation page.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyUnsubscribeToken, type UnsubscribeKind } from '../_shared/unsubscribeToken.ts';
import { logSystem, newRequestId } from '../_shared/log.ts';

const DAISY_BLUE = '#006FAC';

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} — Daisy First Aid</title>
</head>
<body style="margin:0;background:#f5f9fb;font-family:Poppins,Arial,sans-serif;color:#1a4359">
  <div style="max-width:480px;margin:60px auto;padding:0 20px;text-align:center">
    <div style="background:#fff;border-radius:14px;padding:36px 28px">
      <h1 style="font-family:Quicksand,Arial,sans-serif;color:${DAISY_BLUE};font-size:22px;margin:0 0 14px">${title}</h1>
      ${body}
    </div>
    <p style="color:#9bb0bd;font-size:12px;margin-top:16px">
      <a href="https://www.daisyfirstaid.com" style="color:#9bb0bd">daisyfirstaid.com</a>
    </p>
  </div>
</body>
</html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  // RFC 8058 one-click unsubscribe POSTs; browsers GET. Accept both.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return page('Something went wrong', '<p>This link is not valid.</p>', 405);
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('c') ?? '';
  const token = url.searchParams.get('t') ?? '';
  const kind: UnsubscribeKind = url.searchParams.get('k') === 'm' ? 'm' : 'c';
  const action = url.searchParams.get('action') ?? 'unsubscribe';

  if (!UUID_RE.test(id) || !token || !(await verifyUnsubscribeToken(id, token, kind))) {
    return page(
      'This link is not valid',
      '<p style="font-size:15px;line-height:1.6">The unsubscribe link looks incomplete or has been altered. Please use the link from the bottom of one of our emails.</p>',
      403,
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return page('Something went wrong', '<p>Please try again later.</p>', 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Resolve the email behind the token.
  let email: string | null = null;
  if (kind === 'c') {
    const customer = await admin.from('da_customers').select('email').eq('id', id).maybeSingle();
    email = (customer.data as any)?.email ?? null;
  } else {
    const member = await admin
      .from('da_email_list_members')
      .select('email')
      .eq('id', id)
      .maybeSingle();
    email = (member.data as any)?.email ?? null;
  }
  if (!email) {
    return page(
      'This link is not valid',
      '<p style="font-size:15px">We could not find your details.</p>',
      404,
    );
  }
  const emailKey = email.toLowerCase();

  // Any failed write must show the error page — a recipient must NEVER see a
  // success page for an opt-out/opt-in that didn't stick (PECR/GDPR).
  const failPage = async (step: string, errMsg: string) => {
    const requestId = newRequestId();
    await logSystem(admin, {
      level: 'error',
      source: 'unsubscribe',
      requestId,
      entityType: kind === 'c' ? 'customer' : 'email_list_member',
      entityId: id,
      message: `${action} failed at ${step}: ${errMsg}`,
    });
    return page(
      'Something went wrong',
      `<p style="font-size:15px;line-height:1.6">We could not update your email preferences just now — please try the link again in a few minutes. If it keeps happening, reply to any of our emails quoting reference <strong>${requestId}</strong>.</p>`,
      500,
    );
  };

  if (action === 'resubscribe') {
    const del = await admin.from('da_email_suppressions').delete().eq('email', emailKey);
    if (del.error) return await failPage('suppression delete', del.error.message);
    if (kind === 'c') {
      const upd = await admin
        .from('da_customers')
        .update({ marketing_opt_out: false, marketing_opt_out_at: null })
        .eq('id', id);
      if (upd.error) return await failPage('customer flag clear', upd.error.message);
    }
    await admin.from('da_activities').insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: kind === 'c' ? 'customer' : 'email_list_member',
      entity_id: id,
      action: 'marketing_resubscribed',
      metadata: {},
      description: 'Recipient resubscribed to marketing emails',
    });
    return page(
      'Welcome back!',
      '<p style="font-size:15px;line-height:1.6">You have been resubscribed and will receive our first aid tips and refresher emails again.</p>',
    );
  }

  // Opt out: global suppression first (the authoritative check), then the
  // customer-specific bookkeeping.
  const sup = await admin
    .from('da_email_suppressions')
    .upsert({ email: emailKey, source: 'unsubscribe' }, { onConflict: 'email' });
  if (sup.error) return await failPage('suppression upsert', sup.error.message);

  if (kind === 'c') {
    const flag = await admin
      .from('da_customers')
      .update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() })
      .eq('id', id);
    if (flag.error) return await failPage('customer flag set', flag.error.message);

    // Cancel this customer's pending marketing sends. Marketing keys come from
    // da_email_templates; transactional keys (no row / is_marketing=false) stay.
    // Non-fatal if it errors (the suppression above already blocks sends) —
    // but log it, the drainer will cancel on next tick anyway.
    const marketingKeys = await admin
      .from('da_email_templates')
      .select('template_key')
      .eq('is_marketing', true);
    const keys = (marketingKeys.data ?? []).map((r: any) => r.template_key);
    if (keys.length > 0) {
      const cancel = await admin
        .from('da_email_sequences')
        .update({ status: 'cancelled' })
        .eq('customer_id', id)
        .eq('status', 'pending')
        .in('template_key', keys);
      if (cancel.error) {
        await logSystem(admin, {
          level: 'warn',
          source: 'unsubscribe',
          entityType: 'customer',
          entityId: id,
          message: `pending-row cancel failed (suppression already in place): ${cancel.error.message}`,
        });
      }
    }
  }

  await admin.from('da_activities').insert({
    actor_type: 'system',
    actor_id: null,
    entity_type: kind === 'c' ? 'customer' : 'email_list_member',
    entity_id: id,
    action: 'marketing_unsubscribed',
    metadata: {},
    description: 'Recipient unsubscribed from marketing emails',
  });

  const kindParam = kind === 'm' ? '&k=m' : '';
  const resubUrl = `${supabaseUrl}/functions/v1/unsubscribe?c=${encodeURIComponent(id)}${kindParam}&t=${token}&action=resubscribe`;
  return page(
    "You've been unsubscribed",
    `<p style="font-size:15px;line-height:1.6">You will no longer receive first aid tips and offers from Daisy First Aid. Booking confirmations for any classes you book will still reach you.</p>
     <p style="font-size:13px;color:#5a7a8f;line-height:1.6">Changed your mind? <a href="${resubUrl}" style="color:${DAISY_BLUE};font-weight:600">Resubscribe</a>.</p>`,
  );
});

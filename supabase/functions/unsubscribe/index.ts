// supabase/functions/unsubscribe/index.ts
//
// Public one-click unsubscribe for marketing emails (Kartra migration).
// Linked from every email footer and the List-Unsubscribe header as
//   GET /unsubscribe?c=<customer_id>&t=<HMAC token>          → opt out
//   GET /unsubscribe?c=...&t=...&action=resubscribe          → opt back in
// The HMAC (see _shared/unsubscribeToken.ts) means a bare email address can
// never unsubscribe someone else. verify_jwt=false (config.toml): recipients
// click this from their inbox with no Supabase session.
//
// Opting out sets da_customers.marketing_opt_out and cancels the customer's
// pending MARKETING da_email_sequences rows (template keys where
// da_email_templates.is_marketing) — transactional emails are unaffected.
// Responds with a small branded HTML confirmation page.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyUnsubscribeToken } from '../_shared/unsubscribeToken.ts';

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

Deno.serve(async (req: Request) => {
  // RFC 8058 one-click unsubscribe POSTs; browsers GET. Accept both.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return page('Something went wrong', '<p>This link is not valid.</p>', 405);
  }

  const url = new URL(req.url);
  const customerId = url.searchParams.get('c') ?? '';
  const token = url.searchParams.get('t') ?? '';
  const action = url.searchParams.get('action') ?? 'unsubscribe';

  const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId);
  if (!uuidOk || !token || !(await verifyUnsubscribeToken(customerId, token))) {
    return page(
      'This link is not valid',
      '<p style="font-size:15px;line-height:1.6">The unsubscribe link looks incomplete or has been altered. Please use the link from the bottom of one of our emails.</p>',
      403,
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey)
    return page('Something went wrong', '<p>Please try again later.</p>', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const customer = await admin
    .from('da_customers')
    .select('id, email, marketing_opt_out')
    .eq('id', customerId)
    .maybeSingle();
  if (customer.error || !customer.data) {
    return page(
      'This link is not valid',
      '<p style="font-size:15px">We could not find your details.</p>',
      404,
    );
  }

  if (action === 'resubscribe') {
    await admin
      .from('da_customers')
      .update({ marketing_opt_out: false, marketing_opt_out_at: null })
      .eq('id', customerId);
    await admin.from('da_activities').insert({
      actor_type: 'system',
      actor_id: null,
      entity_type: 'customer',
      entity_id: customerId,
      action: 'marketing_resubscribed',
      metadata: {},
      description: 'Customer resubscribed to marketing emails',
    });
    return page(
      'Welcome back!',
      '<p style="font-size:15px;line-height:1.6">You have been resubscribed and will receive our first aid tips and refresher emails again.</p>',
    );
  }

  await admin
    .from('da_customers')
    .update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() })
    .eq('id', customerId);

  // Cancel this customer's pending marketing sends. Marketing keys come from
  // da_email_templates; transactional keys (no row / is_marketing=false) stay.
  const marketingKeys = await admin
    .from('da_email_templates')
    .select('template_key')
    .eq('is_marketing', true);
  const keys = (marketingKeys.data ?? []).map((r: any) => r.template_key);
  if (keys.length > 0) {
    await admin
      .from('da_email_sequences')
      .update({ status: 'cancelled' })
      .eq('customer_id', customerId)
      .eq('status', 'pending')
      .in('template_key', keys);
  }

  await admin.from('da_activities').insert({
    actor_type: 'system',
    actor_id: null,
    entity_type: 'customer',
    entity_id: customerId,
    action: 'marketing_unsubscribed',
    metadata: {},
    description: 'Customer unsubscribed from marketing emails',
  });

  const resubUrl = `${supabaseUrl}/functions/v1/unsubscribe?c=${encodeURIComponent(customerId)}&t=${token}&action=resubscribe`;
  return page(
    "You've been unsubscribed",
    `<p style="font-size:15px;line-height:1.6">You will no longer receive first aid tips and refresher emails from Daisy First Aid. Booking confirmations for any classes you book will still reach you.</p>
     <p style="font-size:13px;color:#5a7a8f;line-height:1.6">Changed your mind? <a href="${resubUrl}" style="color:${DAISY_BLUE};font-weight:600">Resubscribe</a>.</p>`,
  );
});

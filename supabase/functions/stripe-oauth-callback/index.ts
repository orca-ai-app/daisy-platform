// supabase/functions/stripe-oauth-callback/index.ts
//
// GET (no auth — this is the browser redirect target from Stripe's OAuth flow).
//
// Stripe redirects the franchisee here after they authorise on
// connect.stripe.com:  ?code=<ac_…>&state=<signed>   (or ?error=access_denied).
//
// This function:
//   1. Verifies the HMAC-signed `state` → resolves the franchisee id (no DB
//      session table needed).
//   2. Exchanges the single-use `code` at connect.stripe.com/oauth/token using
//      the platform secret key (HTTP Basic auth) → reads `stripe_user_id`, the
//      franchisee's EXISTING connected account id (acct_…).
//   3. Persists it on da_franchisees.stripe_account_id and sets
//      stripe_connected=true (a standalone account is already charges-enabled).
//   4. 302-redirects back to the portal /franchisee/payments?connected=1.
//
// On any failure it redirects back with ?stripe_error=<reason> so the card can
// show a toast rather than dumping a JSON error page on the franchisee.
//
// Deploy flag: --no-verify-jwt  (browser redirect carries no Supabase JWT)

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { verifyState } from '../_shared/oauthState.ts';

/** Resolve the portal origin for the post-OAuth redirect. PORTAL_URL is set in
 *  Supabase secrets; a top-level browser navigation carries no Origin header,
 *  so we cannot derive it from the request. */
function resolvePortalUrl(): string {
  const fromEnv = Deno.env.get('PORTAL_URL');
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'https://daisy-crm-platform.netlify.app';
}

function redirectToPortal(portalUrl: string, query: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${portalUrl}/franchisee/payments?${query}` },
  });
}

Deno.serve(async (req: Request) => {
  const portalUrl = resolvePortalUrl();
  const url = new URL(req.url);

  // Franchisee declined authorisation on Stripe's page.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    console.warn(`stripe-oauth-callback: user-facing OAuth error="${oauthError}"`);
    return redirectToPortal(portalUrl, `stripe_error=${encodeURIComponent(oauthError)}`);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectToPortal(portalUrl, 'stripe_error=missing_code');
  }

  // Env
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
    console.error('stripe-oauth-callback: server misconfigured (env vars missing)');
    return redirectToPortal(portalUrl, 'stripe_error=server_misconfigured');
  }

  // Verify state → franchisee id
  const franchiseeId = await verifyState(state, stripeSecretKey);
  if (!franchiseeId) {
    console.error('stripe-oauth-callback: invalid or expired state');
    return redirectToPortal(portalUrl, 'stripe_error=invalid_state');
  }

  // Exchange the authorization code for the connected account id.
  let stripeUserId: string;
  try {
    const tokenResp = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: {
        // Secret key as HTTP Basic auth username (empty password).
        Authorization: `Basic ${btoa(`${stripeSecretKey}:`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    });

    const tokenBody = (await tokenResp.json()) as {
      stripe_user_id?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResp.ok || !tokenBody.stripe_user_id) {
      console.error('stripe-oauth-callback: token exchange failed', tokenBody);
      return redirectToPortal(portalUrl, 'stripe_error=token_exchange_failed');
    }
    stripeUserId = tokenBody.stripe_user_id;
  } catch (err) {
    console.error('stripe-oauth-callback: token exchange threw', err);
    return redirectToPortal(portalUrl, 'stripe_error=token_exchange_failed');
  }

  // Persist on the franchisee row.
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const updateResult = await admin
    .from('da_franchisees')
    .update({
      stripe_account_id: stripeUserId,
      stripe_connected: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', franchiseeId);

  if (updateResult.error) {
    console.error('stripe-oauth-callback: failed to persist stripe_account_id', updateResult.error);
    return redirectToPortal(portalUrl, 'stripe_error=persist_failed');
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchiseeId,
      entity_type: 'franchisee',
      entity_id: franchiseeId,
      action: 'stripe_connected',
      metadata: { method: 'oauth', stripe_account_id: stripeUserId },
      description: 'Franchisee connected their existing Stripe account (OAuth)',
    })
    .catch((err: unknown) => console.error('stripe-oauth-callback: activity insert failed', err));

  console.log(
    `stripe-oauth-callback: connected franchisee="${franchiseeId}" account="${stripeUserId}"`,
  );

  return redirectToPortal(portalUrl, 'connected=1');
});

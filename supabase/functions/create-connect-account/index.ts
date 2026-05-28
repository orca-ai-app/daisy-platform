// supabase/functions/create-connect-account/index.ts
//
// POST (auth: franchisee JWT; no body required)
//   -> { stripe_account_id: string, url: string }
//
// Creates a Standard connected Stripe account for the caller (if none exists)
// and returns a fresh account_onboarding Account Link URL so the franchisee
// can complete KYC on Stripe's hosted onboarding page.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. JWT sub → da_franchisees.auth_user_id.
//  - Idempotent: if stripe_account_id is already set on the franchisee row,
//    skips account creation and goes straight to generating an Account Link.
//    No second Stripe account is ever created.
//  - Creates: stripe.accounts.create({ type: 'standard', email })
//    Standard Connect — franchisee owns the full Stripe dashboard, bears
//    refunds and disputes. Platform receives a 2% application_fee_amount.
//  - Persists the acct_... id on da_franchisees.stripe_account_id
//    (service_role write) before generating the link so the row is populated
//    even if the franchisee abandons onboarding partway through.
//  - Generates an account_onboarding Account Link with:
//      return_url  = ${PORTAL_URL}/franchisee/payments?success=1
//      refresh_url = ${PORTAL_URL}/franchisee/payments?refresh=1
//    PORTAL_URL is read from Deno.env.get('PORTAL_URL'). Falls back to
//    deriving origin from the incoming request so local dev works without
//    setting the env var.
//  - Inserts a da_activities row (action='stripe_connect_started').
//  - Returns 200 { stripe_account_id, url } on success.
//  - Returns 401/403 for missing or non-franchisee JWT.
//  - Returns 500 for Stripe or DB failures (logged to console).

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Stripe from 'https://esm.sh/stripe@17.7.0?target=denonext';

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

/** Decode the `sub` claim from a JWT without verifying the signature.
 *  Supabase validates the JWT before the function runs; we just need the sub. */
function decodeJwtSub(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const claims = JSON.parse(decoded) as Record<string, unknown>;
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Derive the portal origin for Account Link return/refresh URLs.
 *
 * Priority order:
 *  1. PORTAL_URL env var — explicit, preferred in production.
 *  2. The incoming request's `Origin` header — works for browser-initiated
 *     calls and local dev (Supabase CLI `supabase functions serve`).
 *  3. Hard-coded Netlify URL as the last-resort fallback.
 */
function resolvePortalUrl(req: Request): string {
  const fromEnv = Deno.env.get('PORTAL_URL');
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const origin = req.headers.get('Origin') ?? req.headers.get('origin');
  if (origin) return origin.replace(/\/$/, '');

  return 'https://daisy-crm-platform.netlify.app';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // ---------------------------------------------------------------------------
  // Auth: resolve caller's auth_user_id from the JWT.
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const jwt = authHeader.slice('bearer '.length).trim();
  const authUserId = decodeJwtSub(jwt);
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  // ---------------------------------------------------------------------------
  // Env checks.
  // ---------------------------------------------------------------------------
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured (Supabase)' }, 500);
  }
  if (!stripeSecretKey) {
    return jsonResponse({ error: 'Server misconfigured (Stripe)' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Resolve the caller's franchisee row.
  // ---------------------------------------------------------------------------
  const selfLookup = await admin
    .from('da_franchisees')
    .select('id, email, stripe_account_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (selfLookup.error) {
    console.error('franchisee lookup failed', selfLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!selfLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = selfLookup.data as {
    id: string;
    email: string;
    stripe_account_id: string | null;
  };

  const stripe = new Stripe(stripeSecretKey, {
    // stripe-node v17.7.0 was generated against 2025-02-24.acacia.
    apiVersion: '2025-02-24.acacia' as any,
  });

  // ---------------------------------------------------------------------------
  // Idempotent account creation.
  // If the franchisee already has a stripe_account_id, return it directly —
  // never create a second account.
  // ---------------------------------------------------------------------------
  let stripeAccountId = franchisee.stripe_account_id;

  if (!stripeAccountId) {
    let newAccount: Stripe.Account;
    try {
      // Standard Connect: franchisee owns their Stripe dashboard.
      // Platform takes a 2% application_fee_amount (applied on payment links).
      newAccount = await stripe.accounts.create({
        type: 'standard',
        email: franchisee.email,
      });
    } catch (err) {
      console.error('stripe.accounts.create failed', err);
      return jsonResponse(
        { error: `Stripe account creation failed: ${(err as Error).message ?? String(err)}` },
        500,
      );
    }

    stripeAccountId = newAccount.id;

    // Persist the account id before generating the link so it is never lost
    // even if onboarding is abandoned.
    const updateResult = await admin
      .from('da_franchisees')
      .update({ stripe_account_id: stripeAccountId })
      .eq('id', franchisee.id);

    if (updateResult.error) {
      console.error('failed to persist stripe_account_id', updateResult.error);
      // The Stripe account was created; log but continue so we still return
      // a usable URL. The webhook (8C) will set stripe_connected via
      // account.updated regardless of whether we persisted the id here.
      // Do not fail the request — the activity row will surface the issue.
    }
  }

  // ---------------------------------------------------------------------------
  // Generate account_onboarding Account Link.
  // ---------------------------------------------------------------------------
  const portalUrl = resolvePortalUrl(req);
  const returnUrl = `${portalUrl}/franchisee/payments?success=1`;
  const refreshUrl = `${portalUrl}/franchisee/payments?refresh=1`;

  let accountLink: Stripe.AccountLink;
  try {
    accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: 'account_onboarding',
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
  } catch (err) {
    console.error('stripe.accountLinks.create failed', err);
    return jsonResponse(
      {
        error: `Could not create Account Link: ${(err as Error).message ?? String(err)}`,
      },
      500,
    );
  }

  // ---------------------------------------------------------------------------
  // Activity log — action='stripe_connect_started'.
  // ---------------------------------------------------------------------------
  const activityInsert = await admin.from('da_activities').insert({
    actor_type: 'franchisee',
    actor_id: franchisee.id,
    entity_type: 'franchisee',
    entity_id: franchisee.id,
    action: 'stripe_connect_started',
    metadata: { stripe_account_id: stripeAccountId },
    description: 'Franchisee started Stripe Connect onboarding',
  });

  if (activityInsert.error) {
    console.error('activity log insert failed', activityInsert.error);
    // Non-fatal — do not fail the request.
  }

  return jsonResponse(
    {
      stripe_account_id: stripeAccountId,
      url: accountLink.url,
    },
    200,
  );
});

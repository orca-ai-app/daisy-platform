// supabase/functions/create-account-link/index.ts
//
// POST (auth: franchisee JWT; no body required)
//   -> { url: string }
//
// Re-issues a fresh account_onboarding Account Link for the caller's existing
// connected Stripe account. Used when:
//  - The franchisee returns via ?refresh (Account Links are single-use,
//    ~5 min TTL).
//  - They want to resume an incomplete onboarding session.
//
// Behaviour:
//  - Requires Authorization: Bearer <jwt>. JWT sub → da_franchisees.auth_user_id.
//  - Resolves the caller's own franchisee row (service_role read).
//  - Returns 409 if stripe_account_id is null — the caller must call
//    create-connect-account first.
//  - Generates a fresh account_onboarding Account Link with:
//      return_url  = ${PORTAL_URL}/franchisee/payments?success=1
//      refresh_url = ${PORTAL_URL}/franchisee/payments?refresh=1
//    PORTAL_URL: Deno.env.get('PORTAL_URL') → req Origin header → fallback URL.
//  - Returns 200 { url } on success.
//  - Returns 401/403 for missing/invalid JWT or unprovisioned caller.
//  - Returns 409 if no stripe_account_id exists.
//  - Returns 500 for Stripe / DB failures.

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
 *  2. The incoming request's Origin header — works for local dev.
 *  3. Hard-coded Netlify URL as a last-resort fallback.
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
    .select('id, stripe_account_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (selfLookup.error) {
    console.error('franchisee lookup failed', selfLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!selfLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = selfLookup.data as { id: string; stripe_account_id: string | null };

  // ---------------------------------------------------------------------------
  // Guard: require an existing connected account.
  // Callers without a stripe_account_id must use create-connect-account first.
  // ---------------------------------------------------------------------------
  if (!franchisee.stripe_account_id) {
    return jsonResponse(
      {
        error:
          'No connected Stripe account found. Start onboarding via create-connect-account first.',
      },
      409,
    );
  }

  const stripe = new Stripe(stripeSecretKey, {
    // stripe-node v17.7.0 was generated against 2025-02-24.acacia.
    apiVersion: '2025-02-24.acacia' as any,
  });

  // ---------------------------------------------------------------------------
  // Generate a fresh account_onboarding Account Link.
  // ---------------------------------------------------------------------------
  const portalUrl = resolvePortalUrl(req);
  const returnUrl = `${portalUrl}/franchisee/payments?success=1`;
  const refreshUrl = `${portalUrl}/franchisee/payments?refresh=1`;

  let accountLink: Stripe.AccountLink;
  try {
    accountLink = await stripe.accountLinks.create({
      account: franchisee.stripe_account_id,
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

  return jsonResponse({ url: accountLink.url }, 200);
});

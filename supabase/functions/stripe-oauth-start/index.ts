// supabase/functions/stripe-oauth-start/index.ts
//
// POST (auth: franchisee JWT; no body required)
//   -> { url: string }
//
// Returns a Stripe Connect OAuth authorize URL so the franchisee can connect
// their EXISTING, standalone Stripe account (scope=read_write) with a single
// sign-in — no new account is created, no KYC re-onboarding. This replaces the
// Account-Links create-account flow (create-connect-account), which minted a
// brand-new account and forced full verification.
//
// Flow:
//   franchisee clicks "Connect with Stripe"
//     -> this function returns the authorize URL
//     -> client redirects to connect.stripe.com/oauth/authorize
//     -> franchisee signs into their existing account and authorises
//     -> Stripe redirects to stripe-oauth-callback with ?code&state
//
// The `state` is an HMAC-signed token carrying the franchisee id + a short
// expiry (see _shared/oauthState.ts), so the unauthenticated callback can
// resolve the caller without a server-side session store.
//
// Deploy flag: default (verify_jwt on) — the client sends the franchisee's
// access token; we additionally decode the sub for the franchisee lookup.
//
// Behaviour:
//  - 401 missing/invalid JWT.
//  - 403 caller not provisioned as a franchisee.
//  - 500 server misconfigured (missing STRIPE_CONNECT_CLIENT_ID / SUPABASE_URL /
//    STRIPE_SECRET_KEY).
//  - 200 { url } otherwise.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { signState } from '../_shared/oauthState.ts';

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

/** Decode the `sub` claim from a JWT without verifying the signature. */
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Auth
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  // Env
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const connectClientId = Deno.env.get('STRIPE_CONNECT_CLIENT_ID') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured (Supabase)' }, 500);
  }
  if (!stripeSecretKey) {
    return jsonResponse({ error: 'Server misconfigured (Stripe key)' }, 500);
  }
  if (!connectClientId) {
    return jsonResponse(
      { error: 'Stripe Connect is not configured yet (STRIPE_CONNECT_CLIENT_ID missing).' },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Resolve caller's franchisee row
  const selfLookup = await admin
    .from('da_franchisees')
    .select('id, email')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (selfLookup.error) {
    console.error('stripe-oauth-start: franchisee lookup failed', selfLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!selfLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = selfLookup.data as { id: string; email: string };

  // Build the OAuth authorize URL.
  const redirectUri = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/stripe-oauth-callback`;
  const state = await signState(franchisee.id, stripeSecretKey);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: connectClientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
  });
  // Prefill the franchisee's email on the (rare) account-creation path; for an
  // existing account they just sign in and this is ignored.
  if (franchisee.email) params.set('stripe_user[email]', franchisee.email);

  const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

  // Activity log — connect started.
  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'franchisee',
      entity_id: franchisee.id,
      action: 'stripe_connect_started',
      metadata: { method: 'oauth' },
      description: 'Franchisee started Stripe Connect (OAuth)',
    })
    .catch((err: unknown) => console.error('stripe-oauth-start: activity insert failed', err));

  return jsonResponse({ url }, 200);
});

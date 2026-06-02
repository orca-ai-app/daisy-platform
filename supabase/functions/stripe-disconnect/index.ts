// supabase/functions/stripe-disconnect/index.ts
//
// POST (auth: franchisee JWT; no body required) -> { disconnected: true }
//
// Revokes the platform's OAuth access to the franchisee's connected Stripe
// account (connect.stripe.com/oauth/deauthorize) and clears the link on the
// da_franchisees row. The franchisee keeps their own Stripe account untouched;
// only Daisy's access is removed. They can reconnect any time via OAuth.
//
// Deploy flag: default (verify_jwt on) — client sends the franchisee access token.

// deno-lint-ignore-file no-explicit-any

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse({ error: 'Authorization header required' }, 401);
  }
  const authUserId = decodeJwtSub(authHeader.slice('bearer '.length).trim());
  if (!authUserId) {
    return jsonResponse({ error: 'Invalid JWT' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const connectClientId = Deno.env.get('STRIPE_CONNECT_CLIENT_ID') ?? '';
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !connectClientId) {
    return jsonResponse({ error: 'Server misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const selfLookup = await admin
    .from('da_franchisees')
    .select('id, stripe_account_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (selfLookup.error) {
    console.error('stripe-disconnect: franchisee lookup failed', selfLookup.error);
    return jsonResponse({ error: 'Failed to verify caller' }, 500);
  }
  if (!selfLookup.data) {
    return jsonResponse({ error: 'Caller is not provisioned as a franchisee' }, 403);
  }

  const franchisee = selfLookup.data as { id: string; stripe_account_id: string | null };

  // Revoke OAuth access at Stripe (best-effort — if it's already revoked we
  // still clear our local link). Skipped entirely if no account is linked.
  if (franchisee.stripe_account_id) {
    try {
      const resp = await fetch('https://connect.stripe.com/oauth/deauthorize', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${stripeSecretKey}:`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: connectClientId,
          stripe_user_id: franchisee.stripe_account_id,
        }).toString(),
      });
      if (!resp.ok) {
        const body = await resp.text();
        // Already-deauthorized is fine; log and continue to clear locally.
        console.warn(`stripe-disconnect: deauthorize returned ${resp.status}: ${body}`);
      }
    } catch (err) {
      console.warn('stripe-disconnect: deauthorize request threw (continuing)', err);
    }
  }

  const updateResult = await admin
    .from('da_franchisees')
    .update({
      stripe_account_id: null,
      stripe_connected: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', franchisee.id);

  if (updateResult.error) {
    console.error('stripe-disconnect: failed to clear link', updateResult.error);
    return jsonResponse({ error: 'Failed to disconnect' }, 500);
  }

  await admin
    .from('da_activities')
    .insert({
      actor_type: 'franchisee',
      actor_id: franchisee.id,
      entity_type: 'franchisee',
      entity_id: franchisee.id,
      action: 'stripe_disconnected',
      metadata: { method: 'oauth', stripe_account_id: franchisee.stripe_account_id },
      description: 'Franchisee disconnected their Stripe account',
    })
    .catch((err: unknown) => console.error('stripe-disconnect: activity insert failed', err));

  return jsonResponse({ disconnected: true }, 200);
});

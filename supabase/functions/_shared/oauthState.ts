// supabase/functions/_shared/oauthState.ts
//
// HMAC-signed `state` token for the Stripe Connect OAuth flow.
//
// The authorize step (stripe-oauth-start) runs with the franchisee's JWT and
// knows who they are. The callback (stripe-oauth-callback) is an unauthenticated
// browser redirect from Stripe and does NOT — so we carry the franchisee id in a
// signed, short-lived `state` parameter instead of a DB table. The signature
// (HMAC-SHA256, keyed on STRIPE_SECRET_KEY which never leaves the server) is
// what makes the value tamper-proof and doubles as CSRF protection.

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const b64 =
    input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(key: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

/** Sign `{ fid, exp }` into a `<payload>.<sig>` state token. ttlMs defaults to 10 min. */
export async function signState(
  franchiseeId: string,
  secret: string,
  ttlMs = 600_000,
): Promise<string> {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({ fid: franchiseeId, exp: Date.now() + ttlMs })),
  );
  const sig = base64UrlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** Verify a state token. Returns the franchisee id, or null if invalid/expired. */
export async function verifyState(state: string, secret: string): Promise<string | null> {
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const providedSig = state.slice(dot + 1);

  const expectedSig = base64UrlEncode(await hmac(secret, payload));
  // Constant-time-ish compare: lengths differ → reject; otherwise XOR all bytes.
  if (providedSig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) {
    diff |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;

  try {
    const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as {
      fid?: string;
      exp?: number;
    };
    if (!claims.fid || typeof claims.exp !== 'number') return null;
    if (Date.now() > claims.exp) return null;
    return claims.fid;
  } catch {
    return null;
  }
}

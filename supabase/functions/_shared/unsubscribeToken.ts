// Signed unsubscribe links for marketing emails. The link in every email
// footer is /unsubscribe?c=<customer_id>&t=<HMAC-SHA256(customer_id)> so a
// bare email address can never be used to unsubscribe someone else. Secret
// lives in the UNSUBSCRIBE_SECRET Edge Function secret.

const encoder = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? '';
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not set');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function unsubscribeToken(customerId: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(customerId));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyUnsubscribeToken(customerId: string, token: string): Promise<boolean> {
  const expected = await unsubscribeToken(customerId);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function buildUnsubscribeUrl(customerId: string): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const token = await unsubscribeToken(customerId);
  return `${base}/functions/v1/unsubscribe?c=${encodeURIComponent(customerId)}&t=${token}`;
}

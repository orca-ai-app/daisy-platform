// Signed unsubscribe links for marketing emails. The link in every email
// footer is /unsubscribe?c=<id>&k=<kind>&t=<HMAC-SHA256("<kind>:<id>")> so a
// bare email address can never be used to unsubscribe someone else, and a
// token for one kind can't be replayed against another. Kinds: 'c' = customer
// (da_customers.id, the default when &k is absent), 'm' = CSV list member
// (da_email_list_members.id). Secret lives in the UNSUBSCRIBE_SECRET Edge
// Function secret.
//
// Scheme note: tokens were originally HMAC over the bare customer id; the
// kind-prefixed scheme replaced it on 2026-07-06 before any real marketing
// email had been sent, so no live links use the old scheme.

const encoder = new TextEncoder();

export type UnsubscribeKind = 'c' | 'm';

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

export async function unsubscribeToken(id: string, kind: UnsubscribeKind = 'c'): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(`${kind}:${id}`));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyUnsubscribeToken(
  id: string,
  token: string,
  kind: UnsubscribeKind = 'c',
): Promise<boolean> {
  const expected = await unsubscribeToken(id, kind);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function buildUnsubscribeUrl(
  id: string,
  kind: UnsubscribeKind = 'c',
): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL') ?? '';
  const token = await unsubscribeToken(id, kind);
  const kindParam = kind === 'c' ? '' : `&k=${kind}`;
  return `${base}/functions/v1/unsubscribe?c=${encodeURIComponent(id)}${kindParam}&t=${token}`;
}

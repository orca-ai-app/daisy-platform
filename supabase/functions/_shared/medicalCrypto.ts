// AES-256-GCM field encryption for medical declaration data (PRD §12.1).
// Key (32 bytes, base64) lives in the ENCRYPTION_KEY Edge Function secret — in
// app land, never in the DB or code. The encrypted blob is stored in the
// da_medical_declarations.declaration_data BYTEA column as a Postgres `\x` hex
// literal of (iv ‖ ciphertext); only HQ can decrypt, via decrypt-medical-declaration.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function importKey(): Promise<CryptoKey> {
  const b64 = Deno.env.get('ENCRYPTION_KEY') ?? '';
  if (!b64) throw new Error('ENCRYPTION_KEY is not set');
  const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (raw.length !== 32) throw new Error('ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toByteaHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `\\x${hex}`;
}

function fromByteaHex(literal: string): Uint8Array {
  const hex = literal.startsWith('\\x') ? literal.slice(2) : literal;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

// Returns a `\x…` bytea literal of (12-byte IV ‖ ciphertext).
export async function encryptJson(value: unknown): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return toByteaHex(combined);
}

// Accepts the `\x…` hex string Postgres returns for a bytea column.
export async function decryptJson(byteaHex: string): Promise<unknown> {
  const key = await importKey();
  const combined = fromByteaHex(byteaHex);
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(decoder.decode(pt));
}

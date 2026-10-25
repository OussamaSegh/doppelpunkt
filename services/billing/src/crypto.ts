/** HMAC-SHA-256 helpers (Web Crypto; Workers and Node 20+). */

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, k);
  }
  return k;
}

export function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA-256 of `message` under `secret`, lowercase hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(message)));
}

/** Constant-time string comparison (both sides hashed first, so lengths don't leak either). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i]! ^ v[i]!;
  return diff === 0;
}

/** Keyed hash of an email address for "restore purchase"; the address itself is never stored. */
export const emailHash = (secret: string, email: string) => hmacHex(secret, `email:${email.trim().toLowerCase()}`);

/** Keyed hash of a normalised book code (packages/license normalizeCode). */
export const codeHash = (secret: string, normalizedCode: string) => hmacHex(secret, `code:${normalizedCode}`);

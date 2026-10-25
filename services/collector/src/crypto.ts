/** Keyed hashing (HMAC-SHA-256) with the Web Crypto API, available in Workers and Node 20+. */

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

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA-256 of `message` under `secret`, as lowercase hex, optionally shortened to `chars`. */
export async function hmacHex(secret: string, message: string, chars = 64): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(message));
  return hex(sig).slice(0, chars);
}

/** Compares two strings in time independent of where they differ (both are hashed first). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i]! ^ v[i]!;
  return diff === 0;
}

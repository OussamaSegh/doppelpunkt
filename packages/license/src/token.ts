/**
 * Signed license tokens. A token is
 *
 *   DP1.<base64url(JSON payload)>.<base64url(Ed25519 signature over "DP1.<payload part>")>
 *
 * The billing Worker signs with its private key; the app verifies on the device with WebCrypto
 * against the public key(s) baked into the build (VITE_LICENSE_PUBLIC_KEYS), so unlocks work
 * offline and without an account. The payload holds no personal data: a random purchase id, the
 * product, the unlocked levels and the issue/expiry times.
 */
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './base64url';
import { PAID_LEVELS, productFor, type PaidLevel, type Sku } from './catalog';

export const TOKEN_PREFIX = 'DP1';

export type LicensePayload = {
  v: 1;
  /** Id of the signing key, so keys can be rotated. */
  kid: string;
  /** Random purchase id (also printed on the Stripe receipt). Not linked to a person in the token. */
  pid: string;
  sku: Sku;
  /** Levels this token unlocks. */
  lv: PaidLevel[];
  /** Issued at, seconds since the epoch. */
  iat: number;
  /** Expires at, seconds since the epoch; absent = no expiry. */
  exp?: number;
};

export type VerifyFailure = 'malformed' | 'unknown-key' | 'bad-signature' | 'expired' | 'unsupported';
export type VerifyResult = { ok: true; payload: LicensePayload } | { ok: false; reason: VerifyFailure };

/** Public keys by key id: raw 32-byte Ed25519 keys, base64url. */
export type PublicKeySet = Readonly<Record<string, string>>;

const ED25519 = { name: 'Ed25519' } as const;
const MAX_TOKEN_LENGTH = 2048;

/** Parses "kid1:key1,kid2:key2" (the VITE_LICENSE_PUBLIC_KEYS format). Invalid entries are skipped. */
export function parsePublicKeys(spec: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (spec ?? '').split(',')) {
    const [kid, key] = part.trim().split(':');
    if (!kid || !key || !/^[\w-]{1,32}$/.test(kid)) continue;
    try {
      if (fromBase64Url(key).length === 32) out[kid] = key;
    } catch {
      /* skip */
    }
  }
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importPublic(raw: string): Promise<CryptoKey> {
  let k = keyCache.get(raw);
  if (!k) {
    k = crypto.subtle.importKey('raw', fromBase64Url(raw), ED25519, false, ['verify']);
    keyCache.set(raw, k);
    k.catch(() => keyCache.delete(raw));
  }
  return k;
}

/** Imports a PKCS#8 Ed25519 private key given as base64url (or standard base64). */
export function importPrivateKey(pkcs8: string): Promise<CryptoKey> {
  const clean = pkcs8.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return crypto.subtle.importKey('pkcs8', fromBase64Url(clean), ED25519, false, ['sign']);
}

function isPayload(v: unknown): v is LicensePayload {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const levels = PAID_LEVELS as readonly unknown[];
  return (
    p.v === 1 &&
    typeof p.kid === 'string' &&
    typeof p.pid === 'string' &&
    /^[\w-]{8,64}$/.test(p.pid) &&
    typeof p.sku === 'string' &&
    productFor(p.sku) !== undefined &&
    Array.isArray(p.lv) &&
    p.lv.length > 0 &&
    p.lv.every((l) => levels.includes(l)) &&
    typeof p.iat === 'number' &&
    Number.isFinite(p.iat) &&
    (p.exp === undefined || (typeof p.exp === 'number' && Number.isFinite(p.exp)))
  );
}

/** Splits and decodes a token without checking the signature. */
export function decodeToken(token: string): { payload: LicensePayload; signed: string; signature: Uint8Array<ArrayBuffer> } | undefined {
  const t = token.trim();
  if (t.length > MAX_TOKEN_LENGTH) return undefined;
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return undefined;
  try {
    const payload: unknown = JSON.parse(fromUtf8(fromBase64Url(parts[1]!)));
    if (!isPayload(payload)) return undefined;
    const signature = fromBase64Url(parts[2]!);
    if (signature.length !== 64) return undefined;
    return { payload, signed: `${parts[0]}.${parts[1]}`, signature };
  } catch {
    return undefined;
  }
}

/** Checks the format, the key id, the Ed25519 signature and the expiry. `now` in milliseconds. */
export async function verifyToken(token: string, keys: PublicKeySet, now = Date.now()): Promise<VerifyResult> {
  const decoded = decodeToken(token);
  if (!decoded) return { ok: false, reason: 'malformed' };
  const raw = keys[decoded.payload.kid];
  if (!raw) return { ok: false, reason: 'unknown-key' };
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(ED25519, await importPublic(raw), decoded.signature, utf8(decoded.signed));
  } catch {
    // Browsers without Ed25519 in WebCrypto (very old ones) end up here.
    return { ok: false, reason: 'unsupported' };
  }
  if (!valid) return { ok: false, reason: 'bad-signature' };
  if (decoded.payload.exp !== undefined && decoded.payload.exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload: decoded.payload };
}

/** Signs a payload (billing Worker and tests). */
export async function signToken(payload: LicensePayload, privateKey: CryptoKey): Promise<string> {
  if (!isPayload(payload)) throw new Error('invalid license payload');
  const body = `${TOKEN_PREFIX}.${toBase64Url(utf8(JSON.stringify(payload)))}`;
  const sig = new Uint8Array(await crypto.subtle.sign(ED25519, privateKey, utf8(body)));
  return `${body}.${toBase64Url(sig)}`;
}

const DAY_S = 86_400;

/** Builds the payload for a product: its levels, and an expiry for time-limited products. */
export function payloadFor(sku: Sku, opts: { kid: string; pid: string; now?: number }): LicensePayload {
  const product = productFor(sku);
  if (!product) throw new Error(`unknown sku ${sku}`);
  const iat = Math.floor((opts.now ?? Date.now()) / 1000);
  return {
    v: 1,
    kid: opts.kid,
    pid: opts.pid,
    sku,
    lv: [...product.levels],
    iat,
    ...(product.days ? { exp: iat + product.days * DAY_S } : {}),
  };
}

/** Random purchase id: "dp_" + 20 Crockford base32 characters (100 bits). */
export function newPurchaseId(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let id = 'dp_';
  for (const b of bytes) id += alphabet[b & 31];
  return id;
}

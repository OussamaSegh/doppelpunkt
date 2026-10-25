// Encrypts API keys at rest with a learner passphrase. Web Crypto only (browser and Node 20+).
import { base64ToBytes, bytesToBase64 } from './http';

export const PBKDF2_ITERATIONS = 310_000;

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto is not available in this environment');
  return c.subtle;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

type Payload = { v: 1; salt: string; iv: string; ct: string };

/** Returns base64(JSON {v:1, salt, iv, ct}), each field base64. */
export async function encryptKey(apiKey: string, passphrase: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey)));
  const payload: Payload = { v: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
  return btoa(JSON.stringify(payload));
}

/** Throws Error('Wrong passphrase or corrupted key') when the passphrase does not match. */
export async function decryptKey(payload: string, passphrase: string): Promise<string> {
  let p: Payload;
  try {
    p = JSON.parse(atob(payload)) as Payload;
  } catch {
    throw new Error('Stored key is not in a recognised format');
  }
  if (p?.v !== 1 || !p.salt || !p.iv || !p.ct) throw new Error('Stored key is not in a recognised format');
  const key = await deriveKey(passphrase, base64ToBytes(p.salt), ['decrypt']);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(p.iv) }, key, base64ToBytes(p.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Wrong passphrase or corrupted key');
  }
}

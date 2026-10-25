/**
 * Book access codes, e.g. "B1K7M-3QXRT-4WPH9" (printed in the book).
 *
 *   B1     book tag (BOOKS in catalog.ts): Book 1 unlocks A2
 *   12     random characters (60 bits)
 *   1      check character (Luhn mod 32), so typos are caught on the device before any request
 *
 * Alphabet: Crockford base32 (no I, L, O, U). When normalising, O is read as 0 and I/L as 1,
 * lower case is accepted, and spaces and dashes are ignored. The billing Worker stores only an
 * HMAC of the normalised code (services/billing).
 */
import { BOOKS, type Sku } from './catalog';

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const N = CODE_ALPHABET.length; // 32
export const CODE_RANDOM_LENGTH = 12;
export const CODE_LENGTH = 2 + CODE_RANDOM_LENGTH + 1; // 15

/** Upper case, no separators, O→0, I/L→1. Does not validate. */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** Luhn mod N check character for `body` (characters from CODE_ALPHABET). */
export function checkChar(body: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    const cp = CODE_ALPHABET.indexOf(body[i]!);
    if (cp < 0) throw new Error(`invalid character ${body[i]}`);
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / N) + (addend % N);
    sum += addend;
  }
  return CODE_ALPHABET[(N - (sum % N)) % N]!;
}

export type CodeCheck =
  | { ok: true; code: string; book: string; sku: Sku }
  | { ok: false; reason: 'length' | 'characters' | 'checksum' | 'unknown-book' };

/** Validates format and check character. `code` in the result is normalised (no dashes). */
export function checkCode(input: string): CodeCheck {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) return { ok: false, reason: 'length' };
  if (![...code].every((c) => CODE_ALPHABET.includes(c))) return { ok: false, reason: 'characters' };
  if (checkChar(code.slice(0, -1)) !== code.slice(-1)) return { ok: false, reason: 'checksum' };
  const book = code.slice(0, 2);
  const sku = BOOKS[book];
  if (!sku) return { ok: false, reason: 'unknown-book' };
  return { ok: true, code, book, sku };
}

/** "B1K7M3QXRT4WPH9" → "B1K7M-3QXRT-4WPH9". */
export function formatCode(code: string): string {
  const c = normalizeCode(code);
  return c.match(/.{1,5}/g)?.join('-') ?? c;
}

/** A new random code for a book tag (tools and tests). */
export function generateCode(book: string, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  if (!BOOKS[book]) throw new Error(`unknown book tag ${book}`);
  const bytes = random(CODE_RANDOM_LENGTH);
  let body = book;
  for (let i = 0; i < CODE_RANDOM_LENGTH; i++) body += CODE_ALPHABET[bytes[i]! & 31];
  return body + checkChar(body);
}

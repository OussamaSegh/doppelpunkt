import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  checkChar,
  checkCode,
  decodeToken,
  formatCode,
  formatPrice,
  generateCode,
  importPrivateKey,
  isFreePreview,
  levelUnlocked,
  newPurchaseId,
  normalizeCode,
  parsePublicKeys,
  payloadFor,
  productFor,
  PRODUCTS,
  signToken,
  SOLD_PRODUCTS,
  toBase64Url,
  unitUnlocked,
  unlockedLevels,
  UNGATED,
  verifyToken,
  type Entitlements,
} from '../src';
import { TEST_KEY_ID, TEST_PRIVATE_KEY, TEST_PUBLIC_KEY, TEST_PUBLIC_KEYS_SPEC } from '../src/testing';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const KEYS = { [TEST_KEY_ID]: TEST_PUBLIC_KEY };
const key = () => importPrivateKey(TEST_PRIVATE_KEY);
const PID = 'dp_0123456789abcdefghjk';

async function otherPair() {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { priv: pair.privateKey, pub: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))) };
}

describe('license tokens', () => {
  it('signs and verifies a level token (no expiry)', async () => {
    const token = await signToken(payloadFor('level-a2', { kid: TEST_KEY_ID, pid: PID, now: NOW }), await key());
    expect(token).toMatch(/^DP1\.[\w-]+\.[\w-]+$/);
    const r = await verifyToken(token, KEYS, NOW + 10 * 365 * 86_400_000);
    expect(r).toEqual({ ok: true, payload: { v: 1, kid: 'test', pid: PID, sku: 'level-a2', lv: ['A2'], iat: NOW / 1000 } });
  });

  it('the yearly pass covers A2–C2 and expires after 365 days', async () => {
    const token = await signToken(payloadFor('pass-year', { kid: TEST_KEY_ID, pid: PID, now: NOW }), await key());
    const ok = await verifyToken(token, KEYS, NOW + 364 * 86_400_000);
    expect(ok.ok && ok.payload.lv).toEqual(['A2', 'B1', 'B2', 'C1', 'C2']);
    expect(ok.ok && ok.payload.exp).toBe(NOW / 1000 + 365 * 86_400);
    expect(await verifyToken(token, KEYS, NOW + 365 * 86_400_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a tampered payload', async () => {
    const token = await signToken(payloadFor('level-a2', { kid: TEST_KEY_ID, pid: PID, now: NOW }), await key());
    const [prefix, , sig] = token.split('.');
    const forged = toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, kid: 'test', pid: PID, sku: 'pass-year', lv: ['A2', 'B1', 'B2', 'C1', 'C2'], iat: NOW / 1000 })));
    expect(await verifyToken(`${prefix}.${forged}.${sig}`, KEYS, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a token signed by another key, and unknown key ids', async () => {
    const other = await otherPair();
    const token = await signToken(payloadFor('level-b1', { kid: TEST_KEY_ID, pid: PID, now: NOW }), other.priv);
    expect(await verifyToken(token, KEYS, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
    const rotated = await signToken(payloadFor('level-b1', { kid: 'k2027', pid: PID, now: NOW }), other.priv);
    expect(await verifyToken(rotated, KEYS, NOW)).toEqual({ ok: false, reason: 'unknown-key' });
    // Key rotation: both keys in the set.
    expect((await verifyToken(rotated, { ...KEYS, k2027: other.pub }, NOW)).ok).toBe(true);
  });

  it('rejects malformed tokens', async () => {
    for (const t of ['', 'DP1', 'DP1.a.b', 'XX1.e30.' + 'A'.repeat(86), 'DP1.!!.??', 'x'.repeat(5000)]) {
      expect(await verifyToken(t, KEYS, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
    // Unknown sku / level in an otherwise well-formed payload
    const bad = toBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, kid: 'test', pid: PID, sku: 'level-z9', lv: ['Z9'], iat: 1 })));
    expect(decodeToken(`DP1.${bad}.${'A'.repeat(86)}`)).toBeUndefined();
  });

  it('accepts surrounding whitespace (pasted tokens)', async () => {
    const token = await signToken(payloadFor('book-1', { kid: TEST_KEY_ID, pid: PID, now: NOW }), await key());
    expect((await verifyToken(`  ${token}\n`, KEYS, NOW)).ok).toBe(true);
  });

  it('signToken refuses invalid payloads', async () => {
    await expect(signToken({ ...payloadFor('level-a2', { kid: 'test', pid: PID }), lv: [] }, await key())).rejects.toThrow();
  });

  it('parsePublicKeys reads "kid:key" lists and skips junk', () => {
    expect(parsePublicKeys(TEST_PUBLIC_KEYS_SPEC)).toEqual(KEYS);
    expect(parsePublicKeys(` ${TEST_PUBLIC_KEYS_SPEC} , bad, x:short, :${TEST_PUBLIC_KEY}`)).toEqual(KEYS);
    expect(parsePublicKeys(undefined)).toEqual({});
  });

  it('purchase ids are random and well-formed', () => {
    const a = newPurchaseId();
    expect(a).toMatch(/^dp_[0-9a-hjkmnp-tv-z]{20}$/);
    expect(newPurchaseId()).not.toBe(a);
  });
});

describe('book access codes', () => {
  it('generated codes pass the check and name the book', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode('B1');
      expect(code).toHaveLength(15);
      expect(checkCode(code)).toEqual({ ok: true, code, book: 'B1', sku: 'book-1' });
    }
  });

  it('formats in groups of five and normalises what people type', () => {
    const code = generateCode('B1', () => new Uint8Array(12).fill(0));
    expect(code).toBe(`B1000000000000${checkChar('B1000000000000')}`);
    const shown = formatCode(code);
    expect(shown).toMatch(/^B1000-00000-0000.$/);
    // lower case, spaces, O for 0
    expect(checkCode(shown.toLowerCase().replace(/0/g, 'o').replace(/-/g, ' ')).ok).toBe(true);
    expect(normalizeCode('b1il-o')).toBe('B1110');
  });

  it('catches every single-character typo', () => {
    const code = generateCode('B1');
    for (let i = 0; i < code.length; i++) {
      for (const c of CODE_ALPHABET) {
        if (c === code[i]) continue;
        const typo = code.slice(0, i) + c + code.slice(i + 1);
        const r = checkCode(typo);
        expect(r.ok, typo).toBe(false);
      }
    }
  });

  it('catches swapped neighbours', () => {
    const code = generateCode('B1');
    for (let i = 2; i < code.length - 1; i++) {
      if (code[i] === code[i + 1]) continue;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      expect(checkCode(swapped).ok, swapped).toBe(false);
    }
  });

  it('reports why a code is wrong', () => {
    expect(checkCode('B1')).toEqual({ ok: false, reason: 'length' });
    expect(checkCode('B1#############')).toEqual({ ok: false, reason: 'characters' });
    const body = 'Z9000000000000';
    expect(checkCode(body + checkChar(body))).toEqual({ ok: false, reason: 'unknown-book' });
    expect(() => generateCode('Z9')).toThrow();
  });
});

describe('entitlements', () => {
  const gated = (levels: string[] = []): Entitlements => ({ gated: true, levels: new Set(levels) });

  it('A1 is always free; other levels need an unlock', () => {
    expect(levelUnlocked('A1', gated())).toBe(true);
    expect(levelUnlocked('A2', gated())).toBe(false);
    expect(levelUnlocked('A2', gated(['A2']))).toBe(true);
    expect(levelUnlocked('B1', gated(['A2']))).toBe(false);
  });

  it('unit 1 of a locked level is a free preview', () => {
    expect(unitUnlocked({ level: 'A2', number: 1 }, gated())).toBe(true);
    expect(unitUnlocked({ level: 'A2', number: 2 }, gated())).toBe(false);
    expect(unitUnlocked({ level: 'A2', number: 2 }, gated(['A2']))).toBe(true);
    expect(unitUnlocked({ level: 'A1', number: 12 }, gated())).toBe(true);
    expect(isFreePreview({ level: 'A2', number: 1 })).toBe(true);
    expect(isFreePreview({ level: 'A1', number: 1 })).toBe(false);
  });

  it('without billing everything is open', () => {
    expect(levelUnlocked('C2', UNGATED)).toBe(true);
    expect(unitUnlocked({ level: 'B2', number: 7 }, UNGATED)).toBe(true);
  });

  it('unlockedLevels merges tokens and drops expired passes', () => {
    const level = payloadFor('level-b1', { kid: 'test', pid: PID, now: NOW });
    const pass = payloadFor('pass-year', { kid: 'test', pid: PID, now: NOW });
    expect([...unlockedLevels([level], NOW)]).toEqual(['B1']);
    expect([...unlockedLevels([level, pass], NOW + 86_400_000)].sort()).toEqual(['A2', 'B1', 'B2', 'C1', 'C2']);
    expect([...unlockedLevels([level, pass], NOW + 400 * 86_400_000)]).toEqual(['B1']);
  });
});

describe('catalog', () => {
  it('every paid level and the pass are sold; the book is not', () => {
    expect(SOLD_PRODUCTS.map((p) => p.sku)).toEqual(['level-a2', 'level-b1', 'level-b2', 'level-c1', 'level-c2', 'pass-year']);
    expect(productFor('book-1')?.price).toBeUndefined();
    expect(PRODUCTS.every((p) => p.levels.length > 0)).toBe(true);
  });

  it('formats prices', () => {
    expect(formatPrice({ amount: 1490, currency: 'CHF' })).toMatch(/CHF\s?14\.90/);
  });
});

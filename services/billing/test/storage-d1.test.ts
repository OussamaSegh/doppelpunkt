import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { D1Storage } from '../src/storage-d1';
import { fakeD1 } from './fake-d1';

const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
const db = await fakeD1(schema);

describe.skipIf(!db)('D1Storage on the real migration', () => {
  const s = new D1Storage(db!);
  const row = { pid: 'dp_0123456789abcdefghjk', source: 'checkout' as const, sku: 'level-a2', sessionId: 'cs_1', paymentIntent: 'pi_1', emailHash: 'e'.repeat(64), token: 'DP1.x.y', status: 'paid' as const, createdAt: 1 };

  it('inserts purchases once per pid and session', async () => {
    expect(await s.insertPurchase(row)).toEqual(row);
    // Same session, another pid (a race between webhook and claim): the first row wins.
    expect(await s.insertPurchase({ ...row, pid: 'dp_zzzzzzzzzzzzzzzzzzzz', token: 'DP1.other.z' })).toEqual(row);
    expect(await s.getPurchase(row.pid)).toEqual(row);
    expect(await s.getPurchase('dp_zzzzzzzzzzzzzzzzzzzz')).toBeNull();
  });

  it('marks refunds by payment intent', async () => {
    expect(await s.setStatusByPaymentIntent('pi_1', 'refunded')).toBe(1);
    expect(await s.setStatusByPaymentIntent('pi_1', 'refunded')).toBe(0);
    expect((await s.getPurchaseBySession('cs_1'))?.status).toBe('refunded');
  });

  it('counts code uses atomically and respects max_uses and revocation', async () => {
    await s.putCode({ hash: 'h1', book: 'B1', maxUses: 2, uses: 0, batch: 'b', revoked: false, createdAt: 1 });
    expect(await s.takeCodeUse('h1')).toBe(true);
    expect(await s.takeCodeUse('h1')).toBe(true);
    expect(await s.takeCodeUse('h1')).toBe(false);
    await s.releaseCodeUse('h1');
    expect((await s.getCode('h1'))?.uses).toBe(1);
    await s.putCode({ hash: 'h2', book: 'B1', maxUses: 5, uses: 0, batch: 'b', revoked: true, createdAt: 1 });
    expect(await s.takeCodeUse('h2')).toBe(false);
    expect(await s.takeCodeUse('missing')).toBe(false);
    // A code-redemption purchase has no session id.
    const code = { pid: 'dp_1111111111111111111a', source: 'code' as const, sku: 'book-1', codeHash: 'h1', token: 'DP1.c.d', status: 'paid' as const, createdAt: 2 };
    expect(await s.insertPurchase(code)).toEqual(code);
  });
});

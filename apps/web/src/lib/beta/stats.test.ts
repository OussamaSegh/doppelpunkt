import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsBatch } from '@doppelpunkt/beta-schema';
import { db, getSettings } from '../../db';
import { recordAttempt } from '../progress';
import { fixtureUnit } from '../../test/fixtures';
import { clearBetaDb, COLLECTOR, json, mockFetch } from '../../test/beta';
import { buildStatsBatches, bucketOf, markShown, maybeUploadStats, overallBand, roundTo5, STATS_BATCH_ITEMS } from './stats';
import { ensureInstallId, newInstallId, setStatsOptIn, getBeta, sendPendingForget } from './prefs';
import { resetOutboxBackoff } from './outbox';

const ex = fixtureUnit.exercises[0]!;
const DAY = 86_400_000;

beforeEach(async () => {
  vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
  resetOutboxBackoff();
  await clearBetaDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('install id', () => {
  it('is 32 random hex characters', () => {
    const a = newInstallId();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(newInstallId()).not.toBe(a);
  });

  it('exists only after opting in, rotates after 90 days', async () => {
    expect(await ensureInstallId()).toBeUndefined();
    expect((await getBeta()).installId).toBeUndefined();
    await setStatsOptIn(true);
    const first = (await getBeta()).installId!;
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(await ensureInstallId(new Date(Date.now() + 89 * DAY))).toBe(first);
    const rotated = await ensureInstallId(new Date(Date.now() + 91 * DAY));
    expect(rotated).toMatch(/^[a-f0-9]{32}$/);
    expect(rotated).not.toBe(first);
  });

  it('opting out deletes the id, the aggregate and queued batches, and POSTs /v1/forget', async () => {
    await setStatsOptIn(true);
    const id = (await getBeta()).installId!;
    await db.itemStats.put({ itemId: 'x', attempts: 1, buckets: [0, 0, 1], seconds: 3 });
    await db.outbox.add({ kind: 'stats', body: {} as never, createdAt: '', tries: 0 });
    const m = mockFetch(() => json(200, { ok: true }));
    await setStatsOptIn(false, m.fetch);
    const beta = await getBeta();
    expect(beta).toMatchObject({ stats: false });
    expect(beta.installId).toBeUndefined();
    expect(beta.pendingForget).toBeUndefined();
    expect(await db.itemStats.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(m.calls).toEqual([{ url: `${COLLECTOR}/v1/forget`, body: { installId: id } }]);
  });

  it('retries a forget that could not be sent', async () => {
    await setStatsOptIn(true);
    const id = (await getBeta()).installId!;
    const down = mockFetch(() => Promise.reject(new TypeError('offline')));
    await setStatsOptIn(false, down.fetch);
    expect((await getBeta()).pendingForget).toEqual([id]);
    const up = mockFetch(() => json(200, {}));
    await sendPendingForget(up.fetch);
    expect(up.calls).toHaveLength(1);
    expect((await getBeta()).pendingForget).toBeUndefined();
  });
});

describe('item statistics', () => {
  it('buckets and rounding', () => {
    expect([0, 0.49, 0.5, 0.79, 0.8, 1].map(bucketOf)).toEqual([0, 0, 1, 1, 2, 2]);
    expect([0, 2, 3, 7, 8].map(roundTo5)).toEqual([0, 0, 5, 5, 10]);
  });

  it('counts nothing unless opted in', async () => {
    await recordAttempt(ex, fixtureUnit, 1);
    expect(await db.itemStats.count()).toBe(0);
  });

  it('counts attempts, first try in a bucket, and time since the item was shown', async () => {
    await setStatsOptIn(true);
    markShown(ex.id, Date.now() - 12_000);
    await recordAttempt(ex, fixtureUnit, 0.3);
    await recordAttempt(ex, fixtureUnit, 1);
    const row = await db.itemStats.get(ex.id);
    expect(row).toMatchObject({ attempts: 2, buckets: [1, 0, 0] });
    expect(row!.seconds).toBeGreaterThanOrEqual(11);
    expect(row!.seconds).toBeLessThan(20);
  });

  it('builds StatsBatch envelopes of at most 200 items', () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ itemId: `i${i}`, attempts: 1, buckets: [0, 0, 1] as [number, number, number], seconds: 7 }));
    const batches = buildStatsBatches(rows, { installId: 'a'.repeat(32), band: 'A1+', day: '2026-10-25', contentVersion: '0.4.0' });
    expect(batches.map((b) => b.items.length)).toEqual([STATS_BATCH_ITEMS, STATS_BATCH_ITEMS, 50]);
    for (const b of batches) expect(StatsBatch.safeParse(b).success).toBe(true);
    expect(batches[0]!.items[0]).toEqual({ itemId: 'i0', attempts: 1, buckets: [0, 0, 1], seconds: 5 });
  });

  it('overall band comes from all attempts', async () => {
    expect(overallBand([])).toBeUndefined();
    await recordAttempt(ex, fixtureUnit, 1);
    expect(overallBand(await db.attempts.toArray())).toMatch(/^A[12]\+?$/);
  });

  it('uploads at most once a day, day only, then clears the aggregate', async () => {
    await setStatsOptIn(true);
    await recordAttempt(ex, fixtureUnit, 1);
    const m = mockFetch();
    const now = new Date('2026-10-25T09:30:00');
    expect(await maybeUploadStats({ now, fetchImpl: m.fetch, contentVersion: '0.4.0' })).toBe(true);
    expect(m.calls).toHaveLength(1);
    const [batch] = m.calls[0]!.body as StatsBatch[];
    expect(StatsBatch.parse(batch)).toMatchObject({ kind: 'stats', day: '2026-10-25', contentVersion: '0.4.0', installId: (await getBeta()).installId });
    expect(batch!.items).toEqual([{ itemId: ex.id, attempts: 1, buckets: [0, 0, 1], seconds: expect.any(Number) }]);
    expect(await db.itemStats.count()).toBe(0);
    expect((await getSettings()).beta?.lastStatsDay).toBe('2026-10-25');

    await recordAttempt(ex, fixtureUnit, 1);
    expect(await maybeUploadStats({ now, fetchImpl: m.fetch, contentVersion: '0.4.0' })).toBe(false);
    expect(await maybeUploadStats({ now: new Date('2026-10-26T08:00:00'), fetchImpl: m.fetch, contentVersion: '0.4.0' })).toBe(true);
    expect(m.calls).toHaveLength(2);
  });

  it('does not upload when opted out or without a collector', async () => {
    const m = mockFetch();
    await db.itemStats.put({ itemId: 'x', attempts: 1, buckets: [0, 0, 1], seconds: 3 });
    expect(await maybeUploadStats({ fetchImpl: m.fetch, contentVersion: 't' })).toBe(false);
    await setStatsOptIn(true);
    await db.itemStats.put({ itemId: 'x', attempts: 1, buckets: [0, 0, 1], seconds: 3 });
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    expect(await maybeUploadStats({ fetchImpl: m.fetch, contentVersion: 't' })).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});

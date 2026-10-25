import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrashReport, FeedbackReport } from '@doppelpunkt/beta-schema';
import { db } from '../../db';
import { clearBetaDb, COLLECTOR, json, mockFetch, setOnline } from '../../test/beta';
import { enqueue, flushOutbox, MAX_BODY_BYTES, packBatches, resetOutboxBackoff } from './outbox';
import { buildFeedbackReport, submitReport } from './feedback';
import { collectorUrl } from './config';

const target = { itemId: 'a1-u01-mcq-1', unitId: 'a1-u01', contentVersion: '0.4.0', answer: 'bist' };
const report = (comment?: string): FeedbackReport => buildFeedbackReport(target, { reason: 'typo', comment }, new Date('2026-10-01T10:00:00Z'));
const crash = (i: number): CrashReport => ({
  kind: 'crash',
  appVersion: '0.5.0',
  name: 'TypeError',
  message: `boom ${i}`,
  stack: 'x'.repeat(3900),
  route: '/learn',
  browser: 'Chrome 131',
  at: '2026-10-01T10:00:00.000Z',
});

beforeEach(async () => {
  vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
  resetOutboxBackoff();
  await clearBetaDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('collector config', () => {
  it('needs an https URL (http only for localhost)', () => {
    expect(collectorUrl()).toBe(COLLECTOR);
    vi.stubEnv('VITE_COLLECTOR_URL', 'https://c.example/ ');
    expect(collectorUrl()).toBe('https://c.example');
    vi.stubEnv('VITE_COLLECTOR_URL', 'http://c.example');
    expect(collectorUrl()).toBeUndefined();
    vi.stubEnv('VITE_COLLECTOR_URL', 'http://localhost:8787');
    expect(collectorUrl()).toBe('http://localhost:8787');
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    expect(collectorUrl()).toBeUndefined();
  });
});

describe('outbox', () => {
  it('sends nothing without a collector URL', async () => {
    vi.stubEnv('VITE_COLLECTOR_URL', '');
    const m = mockFetch();
    await enqueue(report());
    expect((await flushOutbox(m.fetch)).status).toBe('inactive');
    expect(m.calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it('waits while offline', async () => {
    setOnline(false);
    const m = mockFetch();
    await enqueue(report());
    expect((await flushOutbox(m.fetch)).status).toBe('offline');
    expect(m.calls).toHaveLength(0);
  });

  it('posts an array of envelopes to /v1/ingest and empties the outbox', async () => {
    const m = mockFetch();
    await enqueue(report('a'));
    await enqueue(report('b'));
    const r = await flushOutbox(m.fetch);
    expect(r).toMatchObject({ status: 'sent', sent: 2, left: 0 });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!.url).toBe(`${COLLECTOR}/v1/ingest`);
    expect(m.calls[0]!.body).toEqual([report('a'), report('b')]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('splits by count (50) and by size (~60 KB)', async () => {
    const small = Array.from({ length: 120 }, (_, i) => ({ body: { i } }));
    expect(packBatches(small).map((b) => b.length)).toEqual([50, 50, 20]);
    const big = Array.from({ length: 40 }, (_, i) => ({ body: crash(i) }));
    const groups = packBatches(big);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(new TextEncoder().encode(JSON.stringify(g.map((r) => r.body))).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('keeps envelopes and backs off on 429 with Retry-After', async () => {
    const m = mockFetch(() => json(429, { error: { message: 'slow down' } }, { 'retry-after': '120' }));
    await enqueue(report());
    expect((await flushOutbox(m.fetch)).status).toBe('error');
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.toArray())[0]!.tries).toBe(1);
    // Within the Retry-After window nothing is sent.
    await flushOutbox(m.fetch);
    expect(m.calls).toHaveLength(1);
  });

  it('keeps envelopes on network errors and 5xx', async () => {
    const m = mockFetch((_c, n) => (n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : json(500, {})));
    await enqueue(report());
    expect((await flushOutbox(m.fetch)).status).toBe('error');
    expect((await flushOutbox(m.fetch)).status).toBe('error');
    expect(await db.outbox.count()).toBe(1);
  });

  it('on 413 splits the batch and retries the halves instead of failing them all', async () => {
    // The collector refuses any request with more than 2 envelopes as too large.
    const m = mockFetch((c) => ((c.body as unknown[]).length > 2 ? json(413, {}) : json(200, { accepted: 2, rejected: 0 })));
    for (let i = 0; i < 5; i++) await enqueue(report(`r${i}`));
    const r = await flushOutbox(m.fetch);
    expect(r).toMatchObject({ status: 'sent', sent: 5, left: 0 });
    expect(m.calls.map((c) => (c.body as unknown[]).length)).toEqual([5, 3, 2, 1, 2]);
  });

  it('marks a single envelope refused for good (4xx) as failed in My reports', async () => {
    const m = mockFetch(() => json(400, {}));
    expect(await submitReport(report(), m.fetch)).toBe('failed');
    expect(await db.outbox.count()).toBe(0);
    expect((await db.reports.toArray())[0]).toMatchObject({ status: 'failed' });
  });

  it('drops envelopes that break the contract without sending them', async () => {
    const m = mockFetch();
    await db.outbox.add({ kind: 'feedback', body: { ...report(), reason: 'nope' } as unknown as FeedbackReport, createdAt: '', tries: 0 });
    await flushOutbox(m.fetch);
    expect(m.calls).toHaveLength(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('caps queued crash reports at 20', async () => {
    for (let i = 0; i < 25; i++) await enqueue({ ...crash(i), stack: undefined });
    expect(await db.outbox.where('kind').equals('crash').count()).toBe(20);
  });
});

describe('feedback reports', () => {
  it('builds exactly the contract fields, the answer only when asked', () => {
    const at = new Date('2026-10-01T10:00:00Z');
    expect(buildFeedbackReport(target, { reason: 'wrong-answer', comment: '  ' }, at)).toEqual({
      kind: 'feedback',
      appVersion: expect.any(String),
      contentVersion: '0.4.0',
      itemId: 'a1-u01-mcq-1',
      unitId: 'a1-u01',
      reason: 'wrong-answer',
      at: '2026-10-01T10:00:00.000Z',
    });
    expect(buildFeedbackReport(target, { reason: 'other', includeAnswer: true }, at).answer).toBe('bist');
    expect(buildFeedbackReport(target, { reason: 'other', comment: 'x'.repeat(600) }, at).comment).toHaveLength(500);
  });

  it('is saved locally and sent at once when online', async () => {
    const m = mockFetch();
    expect(await submitReport(report('hi'), m.fetch)).toBe('sent');
    const rows = await db.reports.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', report: { comment: 'hi' } });
    expect(rows[0]!.sentAt).toBeTruthy();
  });

  it('waits in the outbox when offline and is sent later', async () => {
    const online = setOnline(false);
    const m = mockFetch();
    expect(await submitReport(report(), m.fetch)).toBe('queued');
    expect(m.calls).toHaveLength(0);
    online.mockReturnValue(true);
    await flushOutbox(m.fetch);
    expect((await db.reports.toArray())[0]!.status).toBe('sent');
  });
});

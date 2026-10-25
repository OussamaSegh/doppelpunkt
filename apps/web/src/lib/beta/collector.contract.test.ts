// Contract test: the app's real beta code (builders, outbox, opt-in/out) talks to the real collector
// (services/collector: HTTP handler + in-memory storage) through a fetch bridge. Proves both sides
// agree on the envelopes, the endpoints, the size limits and opt-out, without wrangler or a network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDump } from '@doppelpunkt/beta-schema';
import { handle, MAX_BODY_BYTES as COLLECTOR_MAX_BODY, type Config } from '../../../../../services/collector/src/http';
import { MAX_ENVELOPES as COLLECTOR_MAX_ENVELOPES } from '../../../../../services/collector/src/collector';
import { MemoryRateLimiter } from '../../../../../services/collector/src/ratelimit';
import { MemoryStorage } from '../../../../../services/collector/src/storage-memory';
import { db, todayKey } from '../../db';
import { clearBetaDb } from '../../test/beta';
import { buildCrashReport, reportCrash, resetCrashSession } from './crash';
import { buildFeedbackReport, submitReport } from './feedback';
import { MAX_BODY_BYTES, MAX_ENVELOPES, enqueue, flushOutbox, resetOutboxBackoff } from './outbox';
import { getBeta, setCrashOptIn, setStatsOptIn } from './prefs';
import { maybeUploadStats, noteAttempt } from './stats';

const COLLECTOR = 'https://collector.test';
const APP_ORIGIN = 'https://app.doppelpunkt.test';
const ENV: Config = { INSTALL_SECRET: 'install-secret', RATE_SALT: 'rate-salt', EXPORT_TOKEN: 'export-token', ALLOWED_ORIGINS: APP_ORIGIN };

type Exchange = { path: string; status: number; response: unknown; bytes: number };

/** A fetch that hands the app's requests to the collector's handler, as a browser on APP_ORIGIN would. */
function collector() {
  const storage = new MemoryStorage();
  const limiter = new MemoryRateLimiter();
  const log: Exchange[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('origin', APP_ORIGIN);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const req = new Request(String(input), { method: init?.method ?? 'GET', headers, body });
    const res = await handle(req, ENV, { storage, limiter });
    const response = await res.clone().json().catch(() => undefined);
    log.push({ path: new URL(String(input)).pathname, status: res.status, response, bytes: body ? new TextEncoder().encode(body).length : 0 });
    // The browser would block a response without the CORS header for our origin.
    expect(res.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
    return res;
  }) as typeof fetch;
  const dump = async (): Promise<ExportDump> => {
    const res = await handle(new Request(`${COLLECTOR}/v1/export`, { headers: { authorization: `Bearer ${ENV.EXPORT_TOKEN}` } }), ENV, { storage, limiter });
    expect(res.status).toBe(200);
    return ExportDump.parse(await res.json());
  };
  return { storage, log, fetch: fetchImpl, dump };
}

beforeEach(async () => {
  vi.stubEnv('VITE_COLLECTOR_URL', COLLECTOR);
  resetOutboxBackoff();
  resetCrashSession();
  await clearBetaDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const target = { itemId: 'a1-u01-mcq-1', unitId: 'a1-u01', contentVersion: '0.4.0', answer: 'Ich bin Anna' };

describe('app ↔ collector contract', () => {
  it('the limits agree: the app batches below what the collector accepts', () => {
    expect(MAX_ENVELOPES).toBeLessThanOrEqual(COLLECTOR_MAX_ENVELOPES);
    expect(MAX_BODY_BYTES).toBeLessThan(COLLECTOR_MAX_BODY);
  });

  it('a feedback report built and sent by the app is stored and exported as sent', async () => {
    const c = collector();
    const report = buildFeedbackReport(target, { reason: 'wrong-answer', comment: 'Should be "bin". Write to anna@example.ch', includeAnswer: true });
    expect(await submitReport(report, c.fetch)).toBe('sent');
    expect(c.log).toEqual([expect.objectContaining({ path: '/v1/ingest', status: 200, response: { accepted: 1, rejected: 0 } })]);
    expect((await db.reports.toArray()).map((r) => r.status)).toEqual(['sent']);
    const dump = await c.dump();
    // The collector scrubs the comment again (an email the learner typed despite the warning).
    expect(dump.feedback).toEqual([{ ...report, comment: 'Should be "bin". Write to [email]' }]);
  });

  it('item statistics: one upload a day, accepted in full; the export has a cohort, never the install id', async () => {
    const c = collector();
    await setStatsOptIn(true, c.fetch);
    const { installId } = await getBeta();
    // 450 items: more than two StatsBatches' worth (200 items each).
    for (let i = 0; i < 450; i++) await noteAttempt(`a1-u${String((i % 12) + 1).padStart(2, '0')}-ex-${i}`, i % 3 === 0 ? 1 : 0.4);
    expect(await maybeUploadStats({ fetchImpl: c.fetch, contentVersion: '0.4.0' })).toBe(true);
    const ingests = c.log.filter((l) => l.path === '/v1/ingest');
    expect(ingests.every((l) => l.status === 200 && (l.response as { rejected: number }).rejected === 0)).toBe(true);
    expect(ingests.reduce((n, l) => n + (l.response as { accepted: number }).accepted, 0)).toBe(3);
    expect(await db.outbox.count()).toBe(0);

    const dump = await c.dump();
    const items = dump.stats.flatMap((s) => s.items);
    expect(items).toHaveLength(450);
    expect(dump.stats.every((s) => s.day === todayKey() && s.cohort && !('installId' in s))).toBe(true);
    expect(JSON.stringify(dump)).not.toContain(installId!);
    expect([...c.storage.installs.keys()]).not.toContain(installId);
    expect(c.storage.installs.size).toBe(1);
    expect(dump.retention).toEqual([expect.objectContaining({ installs: 1 })]);

    // Same day again: nothing new is uploaded.
    await noteAttempt('a1-u01-ex-again', 1);
    expect(await maybeUploadStats({ fetchImpl: c.fetch, contentVersion: '0.4.0' })).toBe(false);
    expect(c.log.filter((l) => l.path === '/v1/ingest')).toHaveLength(ingests.length);
  });

  it('opt-out: /v1/forget removes the install on the collector and the id on the device', async () => {
    const c = collector();
    await setStatsOptIn(true, c.fetch);
    await noteAttempt('a1-u01-mcq-1', 1);
    await maybeUploadStats({ fetchImpl: c.fetch, contentVersion: '0.4.0' });
    expect(c.storage.installs.size).toBe(1);

    await setStatsOptIn(false, c.fetch);
    expect(c.log.at(-1)).toEqual(expect.objectContaining({ path: '/v1/forget', status: 200, response: { ok: true } }));
    expect(c.storage.installs.size).toBe(0);
    const beta = await getBeta();
    expect(beta.installId).toBeUndefined();
    expect(beta.pendingForget).toBeUndefined();
    // The item counts already uploaded stay (they are not linked to the install any more).
    expect((await c.dump()).stats.flatMap((s) => s.items)).toHaveLength(1);
  });

  it('a crash report scrubbed by the app passes the collector unchanged', async () => {
    const c = collector();
    await setCrashOptIn(true);
    const err = new TypeError('Cannot read properties of undefined (key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789, user anna@example.ch)');
    err.stack = `TypeError: ${err.message}\n    at render (https://app.doppelpunkt.test/assets/Progress-Ab12Cd34.js:1:23456)\n    at https://app.doppelpunkt.test/assets/react-Zz99.js:2:100`;
    expect(await reportCrash(err, '/unit/a1-u01?item=a1-u01-mcq-1', c.fetch)).toBe(true);
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    const [crash] = (await c.dump()).crashes;
    expect(crash).toMatchObject({ kind: 'crash', name: 'TypeError', route: '/unit/a1-u01' });
    expect(crash!.message).toBe('Cannot read properties of undefined (key [key], user [email])');
    expect(crash!.stack).toBe(`TypeError: ${crash!.message}\n    at render (Progress-Ab12Cd34.js:1:23456)\n    at react-Zz99.js:2:100`);
  });

  it('a full outbox (200 long reports + 20 crashes with long stacks) goes out in requests the collector accepts, with no 413', async () => {
    const c = collector();
    const long = 'Lorem ipsum dolor sit amet. '.repeat(18).slice(0, 500);
    for (let i = 0; i < 200; i++) {
      await enqueue(buildFeedbackReport({ ...target, itemId: `a1-u01-ex-${i}`, answer: 'x'.repeat(300) }, { reason: 'unclear', comment: long, includeAnswer: true }));
    }
    const frames = Array.from({ length: 40 }, (_, i) => `    at Module.Component.render.updateFunctionComponent.beginWork.performUnitOfWork${i} (https://app.doppelpunkt.test/assets/chunk-${i}.js:1:${10000 + i})`).join('\n');
    for (let i = 0; i < 20; i++) {
      const e = new Error(`boom ${i}: ${'the screen could not render this item. '.repeat(12)}`);
      e.stack = `Error: boom ${i}\n${frames}`;
      await enqueue(buildCrashReport(e, '/learn'));
    }
    const r = await flushOutbox(c.fetch);
    expect(r).toMatchObject({ status: 'sent', sent: 220, left: 0 });
    expect(c.log.every((l) => l.status === 200 && l.bytes <= MAX_BODY_BYTES)).toBe(true);
    // 220 envelopes need at least 5 requests by count; the ~4.5 KB crashes make the 60 KB limit bite too.
    expect(c.log.length).toBeGreaterThan(5);
    const dump = await c.dump();
    expect(dump.feedback).toHaveLength(200);
    expect(dump.crashes).toHaveLength(20);
  });

  it('the collector refuses envelopes the app would never send; the app drops what is not in the contract', async () => {
    const c = collector();
    await db.outbox.add({ kind: 'feedback', body: { kind: 'feedback', itemId: 'x' } as never, createdAt: new Date().toISOString(), tries: 0 });
    const ok = buildFeedbackReport(target, { reason: 'typo' });
    await enqueue(ok);
    expect(await flushOutbox(c.fetch)).toMatchObject({ status: 'sent', sent: 1, left: 0 });
    expect(c.log).toEqual([expect.objectContaining({ status: 200, response: { accepted: 1, rejected: 0 } })]);
    // And the other way round: a request from an origin the collector doesn't allow is refused.
    const res = await handle(
      new Request(`${COLLECTOR}/v1/ingest`, { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify(ok) }),
      ENV,
      { storage: c.storage, limiter: new MemoryRateLimiter() },
    );
    expect(res.status).toBe(403);
  });
});

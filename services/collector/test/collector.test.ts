import { ExportDump } from '@doppelpunkt/beta-schema';
import { describe, expect, it } from 'vitest';
import { installHash, purge, retention, uploadDay } from '../src/collector';
import { MAX_BODY_BYTES, handle, type Config } from '../src/index';
import { MemoryRateLimiter } from '../src/ratelimit';
import { scrub, scrubRoute } from '../src/scrub';
import { MemoryStorage } from '../src/storage-memory';
import { isoWeek, weeksBetween } from '../src/time';
import { DAY, ENV, ID_A, ID_B, NOW, crash, feedback, stats } from './helpers';

const BASE = 'https://collector.example.dev';

function setup(env: Config = ENV, now = NOW) {
  const storage = new MemoryStorage();
  const limiter = new MemoryRateLimiter();
  let t = now;
  const call = (req: Request) => handle(req, env, { storage, limiter, now: () => t });
  return { storage, call, setNow: (v: number) => (t = v) };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const getExport = (token = ENV.EXPORT_TOKEN, query = '') =>
  new Request(`${BASE}/v1/export${query}`, { headers: { authorization: `Bearer ${token}` } });

describe('POST /v1/ingest', () => {
  it('accepts one envelope or an array and counts rejects', async () => {
    const { call, storage } = setup();
    const one = await call(post('/v1/ingest', feedback()));
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual({ accepted: 1, rejected: 0 });

    const many = await call(post('/v1/ingest', [feedback(), crash(), stats(), { kind: 'nope' }, { ...feedback(), reason: 'bad' }, 42]));
    expect(await many.json()).toEqual({ accepted: 3, rejected: 3 });
    expect(storage.feedback).toHaveLength(2);
    expect(storage.crashes).toHaveLength(1);
    expect(storage.stats.size).toBe(1);
  });

  it('strips unknown fields', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', { ...feedback(), email: 'x@y.ch', ip: '1.2.3.4' }));
    expect(Object.keys(storage.feedback[0]!)).not.toContain('email');
    expect(Object.keys(storage.feedback[0]!)).not.toContain('ip');
  });

  it('rejects more than 50 envelopes, oversized and non-JSON bodies', async () => {
    const { call, storage } = setup();
    expect((await call(post('/v1/ingest', Array.from({ length: 51 }, () => feedback())))).status).toBe(413);
    expect((await call(post('/v1/ingest', Array.from({ length: 50 }, () => feedback())))).status).toBe(200);
    const big = JSON.stringify([feedback({ comment: 'x'.repeat(500) })]).padEnd(MAX_BODY_BYTES + 1, ' ');
    expect((await call(post('/v1/ingest', big))).status).toBe(413);
    // A lying Content-Length doesn't help: the streamed size is checked too.
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const lying = new Request(`${BASE}/v1/ingest`, { method: 'POST', headers: { 'content-length': '10' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await call(lying)).status).toBe(413);
    expect((await call(post('/v1/ingest', '{nope'))).status).toBe(400);
    expect(storage.feedback).toHaveLength(50);
  });

  it('aggregates item stats without an install id', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', [stats(), stats({ installId: ID_B, items: [{ itemId: 'a1-u01-ex03', attempts: 2, buckets: [0, 1, 1], seconds: 15 }] })]));
    await call(post('/v1/ingest', stats()));
    expect(storage.stats.size).toBe(1);
    const row = [...storage.stats.values()][0]!;
    expect(row).toMatchObject({ itemId: 'a1-u01-ex03', day: '2026-10-21', cohort: '2026-W43', band: 'A1', attempts: 8, buckets: [2, 1, 3], seconds: 95 });
    expect(JSON.stringify([...storage.stats.values()])).not.toContain(ID_A);
    expect(JSON.stringify([...storage.installs.values()])).not.toContain(ID_A);
    expect(storage.installs.size).toBe(2);
  });

  it('rejects implausible stats batches', async () => {
    const { call, storage } = setup();
    const res = await call(post('/v1/ingest', stats({ items: [{ itemId: 'x', attempts: 1, buckets: [5, 0, 0], seconds: 5 }] })));
    expect(await res.json()).toEqual({ accepted: 0, rejected: 1 });
    expect(storage.installs.size).toBe(0);
  });

  it('counts an empty stats batch as activity', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', stats({ items: [] })));
    expect(storage.installs.size).toBe(1);
    expect(storage.stats.size).toBe(0);
  });

  it('scrubs crash reports and feedback text again on the server', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', [
      crash({
        message: 'Failed for anna.muster@example.ch at https://api.example.com/x?token=abc call +41 79 123 45 67',
        stack: 'at g (https://app.example/assets/index-3f9c0e1a2b4d.js:1:1234567)\nat h (https://app.example/?q=secret#frag)',
        route: '/unit/a1-u01?ref=mail',
      }),
      feedback({ comment: 'mail me: me@example.org, card 4111 1111 1111 1111' }),
    ]));
    const c = storage.crashes[0]!;
    expect(c.message).toBe('Failed for [email] at [url] call [number]');
    expect(c.stack).toContain('index-3f9c0e1a2b4d.js:1:1234567');
    expect(c.stack).toContain('[url]');
    expect(c.stack).not.toContain('secret');
    expect(c.route).toBe('/unit/a1-u01');
    expect(storage.feedback[0]!.comment).toBe('mail me: [email], card [number]');
  });

  it('is not configured without secrets', async () => {
    const { call } = setup({});
    expect((await call(post('/v1/ingest', feedback()))).status).toBe(503);
  });

  it('rate limits per client without storing the IP', async () => {
    const { call, storage, setNow } = setup({ ...ENV, RATE_LIMIT_PER_HOUR: '3' });
    const from = (ip: string) => post('/v1/ingest', feedback(), { 'cf-connecting-ip': ip });
    for (let i = 0; i < 3; i++) expect((await call(from('203.0.113.7'))).status).toBe(200);
    const limited = await call(from('203.0.113.7'));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await call(from('198.51.100.2'))).status).toBe(200);
    setNow(NOW + 3_600_000);
    expect((await call(from('203.0.113.7'))).status).toBe(200);
    expect(JSON.stringify(storage.feedback)).not.toContain('203.0.113.7');
  });
});

describe('CORS', () => {
  it('answers preflight and enforces ALLOWED_ORIGINS', async () => {
    const { call } = setup({ ...ENV, ALLOWED_ORIGINS: 'https://doppelpunkt.app, http://localhost:5173' });
    const pre = await call(new Request(`${BASE}/v1/ingest`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(pre.headers.get('access-control-allow-headers')).toContain('content-type');
    expect((await call(post('/v1/ingest', feedback(), { origin: 'https://evil.example' }))).status).toBe(403);
    const ok = await call(post('/v1/ingest', feedback(), { origin: 'https://doppelpunkt.app' }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://doppelpunkt.app');
  });

  it('serves non-browser clients (no Origin) without CORS headers', async () => {
    const { call } = setup({ ...ENV, ALLOWED_ORIGINS: 'https://doppelpunkt.app' });
    const res = await call(getExport());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('POST /v1/forget', () => {
  it('removes the install row', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', [stats(), stats({ installId: ID_B })]));
    expect(storage.installs.size).toBe(2);
    const res = await call(post('/v1/forget', { installId: ID_A }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(storage.installs.size).toBe(1);
    expect(await storage.getInstall(await installHash(ID_A, ENV.INSTALL_SECRET))).toBeNull();
    // Forgetting twice, or an unknown id, still answers ok (no hint whether it existed).
    expect((await call(post('/v1/forget', { installId: ID_A }))).status).toBe(200);
    expect((await call(post('/v1/forget', { installId: 'not-hex' }))).status).toBe(400);
  });
});

describe('GET /v1/export', () => {
  it('requires the bearer token', async () => {
    const { call } = setup();
    expect((await call(new Request(`${BASE}/v1/export`))).status).toBe(401);
    expect((await call(getExport('wrong'))).status).toBe(401);
    const off = setup({ INSTALL_SECRET: 'a', RATE_SALT: 'b' });
    expect((await off.call(getExport())).status).toBe(404);
  });

  it('returns a valid ExportDump with cohorts and retention', async () => {
    const { call, setNow } = setup();
    // Install A: first seen in W43, active again in weeks 1 and 3. Install B: W43 only.
    await call(post('/v1/ingest', [stats(), stats({ installId: ID_B, band: undefined }), feedback({ comment: 'Akkusativ?', answer: 'den Mann' }), crash()]));
    setNow(NOW + 7 * DAY);
    await call(post('/v1/ingest', stats({ day: '2026-10-28' })));
    setNow(NOW + 21 * DAY);
    await call(post('/v1/ingest', stats({ day: '2026-11-11' })));

    const res = await call(getExport());
    expect(res.status).toBe(200);
    const dump = ExportDump.parse(await res.json());
    expect(dump.feedback).toEqual([feedback({ comment: 'Akkusativ?', answer: 'den Mann' })]);
    expect(dump.crashes).toEqual([crash()]);
    expect(dump.retention).toEqual([{ cohortWeek: '2026-W43', installs: 2, activeWeek: [1, 0, 1, 0] }]);
    expect(dump.stats.every((s) => s.cohort === '2026-W43')).toBe(true);
    expect(dump.stats.map((s) => [s.day, s.band ?? null])).toEqual([
      ['2026-10-21', 'A1'], ['2026-10-21', null], ['2026-10-28', 'A1'], ['2026-11-11', 'A1'],
    ]);
    expect(JSON.stringify(dump)).not.toContain(ID_A);

    const since = ExportDump.parse(await (await call(getExport(ENV.EXPORT_TOKEN, '?since=2026-10-28'))).json());
    expect(since.stats.map((s) => s.day)).toEqual(['2026-10-28', '2026-11-11']);
    expect(since.feedback).toEqual([]);
    expect(since.retention).toEqual(dump.retention);
    expect((await call(getExport(ENV.EXPORT_TOKEN, '?since=yesterday'))).status).toBe(400);
  });
});

describe('GET /v1/health and routing', () => {
  it('reports health', async () => {
    const { call } = setup();
    const res = await call(new Request(`${BASE}/v1/health`));
    expect(await res.json()).toEqual({ ok: true, service: 'doppelpunkt-collector', configured: true });
    expect((await call(new Request(`${BASE}/v2/nope`))).status).toBe(404);
    expect((await call(new Request(`${BASE}/v1/ingest`))).status).toBe(405);
  });
});

describe('retention policy', () => {
  it('deletes crashes after 90 days, feedback after a year, installs idle for 120 days', async () => {
    const { call, storage } = setup();
    await call(post('/v1/ingest', [feedback(), crash(), stats()]));
    expect(await purge(storage, NOW + 89 * DAY)).toEqual({ crashes: 0, feedback: 0, installs: 0 });
    expect(await purge(storage, NOW + 91 * DAY)).toEqual({ crashes: 1, feedback: 0, installs: 0 });
    expect(await purge(storage, NOW + 121 * DAY)).toEqual({ crashes: 0, feedback: 0, installs: 1 });
    expect(await purge(storage, NOW + 366 * DAY)).toEqual({ crashes: 0, feedback: 1, installs: 0 });
    expect(storage.stats.size).toBe(1); // aggregates carry no install id and are kept
  });
});

describe('helpers', () => {
  it('computes ISO weeks', () => {
    expect(isoWeek('2026-10-21')).toBe('2026-W43');
    expect(isoWeek('2021-01-03')).toBe('2020-W53');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
    expect(isoWeek('2026-01-01')).toBe('2026-W01');
    expect(weeksBetween('2026-10-25', '2026-10-26')).toBe(1); // Sunday -> Monday
  });

  it('trusts the client day only within one day of the server', () => {
    expect(uploadDay('2026-10-20', NOW)).toBe('2026-10-20');
    expect(uploadDay('2026-10-01', NOW)).toBe('2026-10-21');
    expect(uploadDay('2026-02-31', NOW)).toBe('2026-10-21');
  });

  it('builds retention from the bitmap', () => {
    expect(retention([
      { hash: 'x', firstSeenDay: '2026-10-19', firstSeenWeek: '2026-W43', lastSeenDay: '2026-11-16', activeWeeks: 0b11111 },
      { hash: 'y', firstSeenDay: '2026-10-12', firstSeenWeek: '2026-W42', lastSeenDay: '2026-10-12', activeWeeks: 1 },
    ])).toEqual([
      { cohortWeek: '2026-W42', installs: 1, activeWeek: [0, 0, 0, 0] },
      { cohortWeek: '2026-W43', installs: 1, activeWeek: [1, 1, 1, 1] },
    ]);
  });

  it('scrubs without eating useful numbers', () => {
    expect(scrub('Ich habe 1984 Franken bezahlt')).toBe('Ich habe 1984 Franken bezahlt');
    expect(scrub('chunk-1234567890ab.js:12:345678')).toBe('chunk-1234567890ab.js:12:345678');
    expect(scrub('see https://doppelpunkt.app/unit/a1-u01')).toBe('see https://doppelpunkt.app/unit/a1-u01');
    expect(scrubRoute('/review#card-1')).toBe('/review');
  });
});

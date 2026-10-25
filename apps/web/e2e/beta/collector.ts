// In-process mock of services/collector for the beta-build specs. The beta build (dist-beta) has
// VITE_COLLECTOR_URL = COLLECTOR_ORIGIN, where nothing listens: page.route answers instead, records
// every request and validates every envelope with the real contract (BetaEnvelope). A request the
// route misses fails the test with a connection error (console errors fail every test).
import type { BrowserContext, Page, Request, Route } from '@playwright/test';
import { BetaEnvelope, ENDPOINTS, InstallId, type CrashReport, type FeedbackReport, type StatsBatch } from '@doppelpunkt/beta-schema';
import { expect, test as base } from '../fixtures';

/** Keep in sync with E2E_COLLECTOR_URL in vite.config.ts. */
export const COLLECTOR_ORIGIN = 'http://127.0.0.1:4329';
export const FORGET = '/v1/forget';

export type CollectorRequest = {
  method: string;
  path: string;
  /** Raw request body as sent. */
  text: string;
  bytes: number;
  /** Parsed JSON body (undefined when not JSON). */
  body: unknown;
  status: number;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-expose-headers': 'retry-after',
};

export class MockCollector {
  readonly requests: CollectorRequest[] = [];
  /** Contract violations: envelopes BetaEnvelope rejects, or with fields it would strip. */
  readonly problems: string[] = [];
  /** Answer 413 to ingest bodies larger than this (the real collector: 64 KB). */
  maxBodyBytes = 64 * 1024;
  /** Answer every ingest/forget with this status instead (e.g. 503), when set. */
  failWith: number | undefined;

  /** Requests other than CORS preflights. */
  get calls(): CollectorRequest[] {
    return this.requests.filter((r) => r.method !== 'OPTIONS');
  }

  ingestCalls(): CollectorRequest[] {
    return this.calls.filter((r) => r.path === ENDPOINTS.ingest);
  }

  forgetCalls(): CollectorRequest[] {
    return this.calls.filter((r) => r.path === FORGET);
  }

  /** Every envelope the collector accepted (2xx ingest requests), in order. */
  accepted(): BetaEnvelope[] {
    return this.ingestCalls()
      .filter((r) => r.status === 200)
      .flatMap((r) => (Array.isArray(r.body) ? r.body : [r.body]) as BetaEnvelope[]);
  }

  feedback = (): FeedbackReport[] => this.accepted().filter((e): e is FeedbackReport => e.kind === 'feedback');
  stats = (): StatsBatch[] => this.accepted().filter((e): e is StatsBatch => e.kind === 'stats');
  crashes = (): CrashReport[] => this.accepted().filter((e): e is CrashReport => e.kind === 'crash');

  async install(target: BrowserContext | Page): Promise<void> {
    await target.route(`${COLLECTOR_ORIGIN}/**`, (route) => this.handle(route));
  }

  private validate(list: unknown[]): void {
    for (const raw of list) {
      const parsed = BetaEnvelope.safeParse(raw);
      if (!parsed.success) this.problems.push(`invalid envelope: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      // zod strips unknown keys: anything stripped is a field the contract doesn't allow.
      else if (JSON.stringify(sortKeys(parsed.data)) !== JSON.stringify(sortKeys(raw))) this.problems.push(`extra fields in ${JSON.stringify(raw)}`);
    }
  }

  private async handle(route: Route): Promise<void> {
    const req: Request = route.request();
    const url = new URL(req.url());
    const text = req.postData() ?? '';
    const bytes = Buffer.byteLength(text, 'utf8');
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    const record = (status: number) => this.requests.push({ method: req.method(), path: url.pathname, text, bytes, body, status });
    const reply = async (status: number, json?: unknown) => {
      record(status);
      await route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: json === undefined ? '' : JSON.stringify(json) });
    };

    if (req.method() === 'OPTIONS') {
      record(204);
      return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-max-age': '600' } });
    }
    if (url.pathname === ENDPOINTS.health) return reply(200, { ok: true });
    if (req.method() !== 'POST') return reply(405, { error: { message: 'Method not allowed' } });
    if (req.headers()['content-type'] !== 'application/json') this.problems.push(`${url.pathname}: content-type ${req.headers()['content-type']}`);
    if (this.failWith) return reply(this.failWith, { error: { message: 'mock failure' } });

    if (url.pathname === FORGET) {
      const id = (body as { installId?: unknown } | undefined)?.installId;
      if (!InstallId.safeParse(id).success) {
        this.problems.push(`forget with an invalid id: ${text}`);
        return reply(400, { error: { message: 'installId must be 32 lowercase hex characters' } });
      }
      if (Object.keys(body as object).length !== 1) this.problems.push(`forget body has extra fields: ${text}`);
      return reply(200, { ok: true });
    }
    if (url.pathname === ENDPOINTS.ingest) {
      if (bytes > this.maxBodyBytes) return reply(413, { error: { message: `Body larger than ${this.maxBodyBytes} bytes` } });
      const list = Array.isArray(body) ? body : [body];
      if (list.length > 50) return reply(413, { error: { message: 'At most 50 envelopes per request' } });
      this.validate(list);
      return reply(200, { accepted: list.length, rejected: 0 });
    }
    return reply(404, { error: { message: 'Not found' } });
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

/** Beta-build test: a fresh mock collector per test; afterwards no contract violations are allowed. */
export const test = base.extend<{ collector: MockCollector }>({
  collector: [
    async ({ context }, use) => {
      const c = new MockCollector();
      await c.install(context);
      await use(c);
      expect(c.problems, 'every request to the collector follows the beta contract').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

type Row = Record<string, unknown>;

/**
 * Reads or writes the app's IndexedDB ("doppelpunkt") from the page with the raw API (no eval, so a
 * strict CSP can't get in the way). `writes` are put/add per store, applied in one transaction.
 */
async function idb(page: Page, op: { read?: { store: string; key?: string }; writes?: Array<{ store: string; put?: Row; add?: Row }> }): Promise<unknown> {
  return page.evaluate(async (op) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('doppelpunkt');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const done = <R,>(r: IDBRequest<R>) =>
      new Promise<R>((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    try {
      if (op.read) {
        const store = db.transaction(op.read.store).objectStore(op.read.store);
        return await done(op.read.key === undefined ? store.getAll() : store.get(op.read.key));
      }
      const writes = op.writes ?? [];
      const tx = db.transaction([...new Set(writes.map((w) => w.store))], 'readwrite');
      const ids: unknown[] = [];
      for (const w of writes) {
        const store = tx.objectStore(w.store);
        ids.push(await done(w.put ? store.put(w.put) : store.add(w.add!)));
      }
      return ids;
    } finally {
      db.close();
    }
  }, op);
}

export type SettingsRow = Row & { beta?: Row & { stats?: boolean; crashes?: boolean; installId?: string; pendingForget?: string[]; lastStatsDay?: string } };

/** The app's settings row (key "app"). */
export const readSettings = (page: Page) => idb(page, { read: { store: 'settings', key: 'app' } }) as Promise<SettingsRow>;

export const readAll = (page: Page, store: string) => idb(page, { read: { store } }) as Promise<Row[]>;

/** Merges `patch` into the settings row. Reload afterwards: the app's live queries don't see raw writes. */
export async function patchSettings(page: Page, patch: Row): Promise<void> {
  const cur = await readSettings(page);
  await idb(page, { writes: [{ store: 'settings', put: { ...cur, ...patch } }] });
}

export const putRows = (page: Page, store: string, rows: Row[]) => idb(page, { writes: rows.map((put) => ({ store, put })) });

/** Queues feedback envelopes as the app does (outbox row + "My reports" row), all in one transaction. */
export async function queueReports(page: Page, reports: FeedbackReport[]): Promise<void> {
  await page.evaluate(async (reports) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('doppelpunkt');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['outbox', 'reports'], 'readwrite');
      for (const body of reports) {
        const add = tx.objectStore('outbox').add({ kind: 'feedback', body, createdAt: new Date().toISOString(), tries: 0 });
        add.onsuccess = () => tx.objectStore('reports').add({ report: body, outboxId: add.result, status: 'queued' });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, reports);
}

/** Waits until `fn` holds for the collector, polling (requests arrive asynchronously). */
export const until = (fn: () => boolean | number, message: string, timeout = 10_000) =>
  expect.poll(() => Number(fn()), { message, timeout }).toBeGreaterThan(0);

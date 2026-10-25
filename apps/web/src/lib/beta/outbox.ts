// Outbox for beta envelopes: stored in IndexedDB first, sent to the collector when online.
// Nothing is sent when this build has no collector URL.
import { BetaEnvelope, ENDPOINTS } from '@doppelpunkt/beta-schema';
import { db, type OutboxRow } from '../../db';
import { collectorUrl, isOnline, MAX_QUEUED_CRASHES } from './config';
import { sendPendingForget } from './prefs';

/** The collector takes at most 50 envelopes and 64 KB per request; stay a little below. */
export const MAX_ENVELOPES = 50;
export const MAX_BODY_BYTES = 60 * 1024;

export type FlushResult = { status: 'inactive' | 'offline' | 'sent' | 'error' | 'empty'; sent: number; left: number; error?: string };

const byteLength = (s: string) => new TextEncoder().encode(s).length;

/** Groups rows into requests of at most 50 envelopes and ~60 KB of JSON (a single larger row goes alone). */
export function packBatches<T extends { body: unknown }>(rows: T[], maxBytes = MAX_BODY_BYTES, maxCount = MAX_ENVELOPES): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 2; // "[]"
  for (const r of rows) {
    const n = byteLength(JSON.stringify(r.body)) + 1;
    if (cur.length && (cur.length >= maxCount || size + n > maxBytes)) {
      out.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Earliest time of the next attempt after a 429/503 with Retry-After (module state; resets on reload). */
let retryAfterUntil = 0;

function retryAfterMs(res: Response): number {
  const h = res.headers.get('retry-after');
  if (!h) return 60_000;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(3_600_000, Math.max(0, secs * 1000));
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.min(3_600_000, Math.max(0, at - Date.now())) : 60_000;
}

/** For tests. */
export function resetOutboxBackoff(): void {
  retryAfterUntil = 0;
}

/** Adds an envelope to the outbox; returns the row id (undefined when it was dropped). */
export async function enqueue(body: BetaEnvelope): Promise<number | undefined> {
  if (body.kind === 'crash' && (await db.outbox.where('kind').equals('crash').count()) >= MAX_QUEUED_CRASHES) return undefined;
  const row: OutboxRow = { kind: body.kind, body, createdAt: new Date().toISOString(), tries: 0 };
  return db.outbox.add(row);
}

let running: Promise<FlushResult> | undefined;

/** Sends queued envelopes (50 per request). One flush at a time; concurrent callers share it. */
export function flushOutbox(fetchImpl: typeof fetch = fetch): Promise<FlushResult> {
  running ??= doFlush(fetchImpl).finally(() => {
    running = undefined;
  });
  return running;
}

async function markReports(ids: number[], patch: { status: 'sent' | 'failed'; error?: string }) {
  if (!ids.length) return;
  const sentAt = new Date().toISOString();
  await db.reports
    .where('outboxId')
    .anyOf(ids)
    .modify((r) => {
      r.status = patch.status;
      delete r.outboxId;
      if (patch.status === 'sent') r.sentAt = sentAt;
      if (patch.error) r.error = patch.error;
    });
}

type Outcome = { kind: 'sent' } | { kind: 'refused'; status: number } | { kind: 'retry'; error: string };

async function post(base: string, rows: OutboxRow[], fetchImpl: typeof fetch): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}${ENDPOINTS.ingest}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rows.map((r) => r.body)),
      credentials: 'omit',
    });
  } catch (e) {
    return { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
  }
  if (res.ok) return { kind: 'sent' };
  if (res.status === 429 || res.status === 503) {
    retryAfterUntil = Date.now() + retryAfterMs(res);
    return { kind: 'retry', error: `HTTP ${res.status}` };
  }
  if (res.status >= 400 && res.status < 500 && res.status !== 408) return { kind: 'refused', status: res.status };
  return { kind: 'retry', error: `HTTP ${res.status}` };
}

/**
 * Sends a group; on 413 (too large) splits it in halves and retries each, so one big envelope
 * never takes the others down with it. Returns how many were sent, or a retry error.
 */
async function sendGroup(base: string, rows: OutboxRow[], fetchImpl: typeof fetch): Promise<{ sent: number; retry?: string }> {
  const outcome = await post(base, rows, fetchImpl);
  const ids = rows.map((r) => r.id).filter((id): id is number => id !== undefined);
  if (outcome.kind === 'sent') {
    await db.outbox.bulkDelete(ids);
    await markReports(ids, { status: 'sent' });
    return { sent: rows.length };
  }
  if (outcome.kind === 'retry') {
    await bumpTries(rows);
    return { sent: 0, retry: outcome.error };
  }
  if (outcome.status === 413 && rows.length > 1) {
    const mid = Math.ceil(rows.length / 2);
    const a = await sendGroup(base, rows.slice(0, mid), fetchImpl);
    if (a.retry) return a;
    const b = await sendGroup(base, rows.slice(mid), fetchImpl);
    return { sent: a.sent + b.sent, retry: b.retry };
  }
  // Refused for good (a single envelope too large, or invalid for the collector).
  await db.outbox.bulkDelete(ids);
  await markReports(ids, { status: 'failed', error: `The beta server refused it (HTTP ${outcome.status}).` });
  return { sent: 0 };
}

async function doFlush(fetchImpl: typeof fetch): Promise<FlushResult> {
  const base = collectorUrl();
  const left = () => db.outbox.count();
  if (!base) return { status: 'inactive', sent: 0, left: await left() };
  if (!isOnline()) return { status: 'offline', sent: 0, left: await left() };
  if (Date.now() < retryAfterUntil) return { status: 'error', sent: 0, left: await left(), error: 'The beta server asked to try later.' };
  await sendPendingForget(fetchImpl);
  const rows = await db.outbox.orderBy('id').toArray();
  if (!rows.length) return { status: 'empty', sent: 0, left: 0 };
  // Never send anything the contract doesn't allow; drop such rows.
  const valid: OutboxRow[] = [];
  const invalid: number[] = [];
  for (const r of rows) {
    if (BetaEnvelope.safeParse(r.body).success) valid.push(r);
    else if (r.id !== undefined) invalid.push(r.id);
  }
  if (invalid.length) {
    await db.outbox.bulkDelete(invalid);
    await markReports(invalid, { status: 'failed', error: 'Not in the expected format.' });
  }
  let sent = 0;
  for (const group of packBatches(valid)) {
    const r = await sendGroup(base, group, fetchImpl);
    sent += r.sent;
    if (r.retry) return { status: 'error', sent, left: await left(), error: r.retry };
  }
  return { status: sent ? 'sent' : 'empty', sent, left: await left() };
}

async function bumpTries(rows: OutboxRow[]) {
  await db.outbox.bulkPut(rows.map((r) => ({ ...r, tries: r.tries + 1 })));
}

/** Counts per kind of what is waiting, for the beta screen. */
export async function outboxSummary(): Promise<Record<OutboxRow['kind'], number>> {
  const rows = await db.outbox.toArray();
  const out = { feedback: 0, stats: 0, crash: 0 };
  for (const r of rows) out[r.kind] += 1;
  return out;
}

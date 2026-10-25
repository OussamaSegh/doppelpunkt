/**
 * Collector logic, independent of HTTP and of D1: validate and store envelopes, build the export,
 * forget an install, apply the retention policy.
 */
import { BetaEnvelope, InstallId, type CrashReport, type ExportDump, type FeedbackReport, type StatsBatch } from '@doppelpunkt/beta-schema';
import { hmacHex } from './crypto';
import { scrub, scrubOptional, scrubRoute } from './scrub';
import type { CrashRow, FeedbackRow, InstallRow, PurgeResult, StatRow, Storage } from './storage';
import { statKey } from './storage';
import { DAY_MS, dayNumber, isoDay, isoWeek, weeksBetween } from './time';

export const MAX_ENVELOPES = 50;
export const RETENTION = { crashDays: 90, feedbackDays: 365, installIdleDays: 120 } as const;
/** Sanity caps per item and upload; batches above them are rejected as implausible. */
export const ITEM_CAPS = { attempts: 1000, seconds: 6 * 3600 } as const;
/** Weeks tracked in the install bitmap (bits 0..30). */
const MAX_WEEK_BIT = 30;

export interface IngestResult {
  accepted: number;
  rejected: number;
}

/** Hash of an install id under the server secret. The raw id is never stored. */
export function installHash(installId: string, secret: string): Promise<string> {
  return hmacHex(secret, `install:${installId}`);
}

/**
 * The day an upload counts for. The app sends its own date; accept it when it is within a day of
 * the server's (time zones, uploads just after midnight), otherwise use the server's date.
 */
export function uploadDay(clientDay: string, now: number): string {
  const server = isoDay(now);
  const diff = dayNumber(clientDay) - dayNumber(server);
  return Number.isFinite(diff) && diff >= -1 && diff <= 1 ? clientDay : server;
}

function plausible(batch: StatsBatch): boolean {
  return batch.items.every(
    (i) => i.attempts <= ITEM_CAPS.attempts && i.seconds <= ITEM_CAPS.seconds && i.buckets[0] + i.buckets[1] + i.buckets[2] <= i.attempts,
  );
}

/** Records activity for an install and returns its cohort (first-seen ISO week). */
async function touchInstall(storage: Storage, hash: string, day: string): Promise<string> {
  const cur = await storage.getInstall(hash);
  if (!cur) {
    const row: InstallRow = { hash, firstSeenDay: day, firstSeenWeek: isoWeek(day), lastSeenDay: day, activeWeeks: 1 };
    await storage.putInstall(row);
    return row.firstSeenWeek;
  }
  const week = weeksBetween(cur.firstSeenDay, day);
  const next: InstallRow = {
    ...cur,
    lastSeenDay: day > cur.lastSeenDay ? day : cur.lastSeenDay,
    activeWeeks: week >= 0 && week <= MAX_WEEK_BIT ? cur.activeWeeks | (1 << week) : cur.activeWeeks,
  };
  if (next.lastSeenDay !== cur.lastSeenDay || next.activeWeeks !== cur.activeWeeks) await storage.putInstall(next);
  return cur.firstSeenWeek;
}

export async function ingest(storage: Storage, input: unknown[], opts: { installSecret: string; now: number }): Promise<IngestResult> {
  const feedback: FeedbackRow[] = [];
  const crashes: CrashRow[] = [];
  const stats = new Map<string, StatRow>();
  let rejected = 0;

  for (const raw of input) {
    const parsed = BetaEnvelope.safeParse(raw); // unknown fields are stripped
    if (!parsed.success) {
      rejected++;
      continue;
    }
    const env = parsed.data;
    if (env.kind === 'feedback') feedback.push(feedbackRow(env, opts.now));
    else if (env.kind === 'crash') crashes.push(crashRow(env, opts.now));
    else {
      if (!plausible(env)) {
        rejected++;
        continue;
      }
      const day = uploadDay(env.day, opts.now);
      const cohort = await touchInstall(storage, await installHash(env.installId, opts.installSecret), day);
      for (const item of env.items) {
        const row: StatRow = {
          itemId: item.itemId,
          contentVersion: env.contentVersion,
          appVersion: env.appVersion,
          band: env.band ?? '',
          day,
          cohort,
          attempts: item.attempts,
          buckets: [...item.buckets],
          seconds: item.seconds,
        };
        const k = statKey(row);
        const cur = stats.get(k);
        if (!cur) stats.set(k, row);
        else {
          cur.attempts += row.attempts;
          cur.seconds += row.seconds;
          cur.buckets = [cur.buckets[0] + row.buckets[0], cur.buckets[1] + row.buckets[1], cur.buckets[2] + row.buckets[2]];
        }
      }
    }
  }

  if (feedback.length) await storage.addFeedback(feedback);
  if (crashes.length) await storage.addCrashes(crashes);
  if (stats.size) await storage.addStats([...stats.values()]);
  return { accepted: input.length - rejected, rejected };
}

function feedbackRow(f: FeedbackReport, now: number): FeedbackRow {
  return {
    receivedAt: now,
    appVersion: f.appVersion,
    contentVersion: f.contentVersion,
    itemId: f.itemId,
    unitId: f.unitId,
    reason: f.reason,
    comment: scrubOptional(f.comment),
    answer: scrubOptional(f.answer),
    at: f.at,
  };
}

function crashRow(c: CrashReport, now: number): CrashRow {
  return {
    receivedAt: now,
    appVersion: c.appVersion,
    name: scrub(c.name),
    message: scrub(c.message),
    stack: scrubOptional(c.stack),
    route: scrubRoute(c.route),
    browser: c.browser,
    at: c.at,
  };
}

/** Removes the install row for an opt-out. Returns false for an invalid id. */
export async function forget(storage: Storage, installId: unknown, installSecret: string): Promise<boolean> {
  const id = InstallId.safeParse(installId);
  if (!id.success) return false;
  await storage.deleteInstall(await installHash(id.data, installSecret));
  return true;
}

export function retention(installs: InstallRow[]): ExportDump['retention'] {
  const cohorts = new Map<string, { installs: number; activeWeek: number[] }>();
  for (const r of installs) {
    let c = cohorts.get(r.firstSeenWeek);
    if (!c) cohorts.set(r.firstSeenWeek, (c = { installs: 0, activeWeek: [0, 0, 0, 0] }));
    c.installs++;
    for (let w = 1; w <= 4; w++) if (r.activeWeeks & (1 << w)) c.activeWeek[w - 1]!++;
  }
  return [...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohortWeek, c]) => ({ cohortWeek, ...c }));
}

/** Builds the authenticated export. `sinceDay` (ISO date) limits feedback, crashes and stats; retention is always complete. */
export async function buildExport(storage: Storage, opts: { now: number; sinceDay?: string }): Promise<ExportDump> {
  const sinceDay = opts.sinceDay ?? '0000-01-01';
  const sinceMs = opts.sinceDay ? dayNumber(opts.sinceDay) * DAY_MS : 0;
  const [feedback, crashes, stats, installs] = await Promise.all([
    storage.listFeedback(sinceMs),
    storage.listCrashes(sinceMs),
    storage.listStats(sinceDay),
    storage.listInstalls(),
  ]);

  const groups = new Map<string, ExportDump['stats'][number]>();
  for (const r of stats) {
    const k = JSON.stringify([r.appVersion, r.contentVersion, r.band, r.day, r.cohort]);
    let g = groups.get(k);
    if (!g) {
      g = { kind: 'stats', appVersion: r.appVersion, contentVersion: r.contentVersion, day: r.day, cohort: r.cohort, items: [] };
      if (r.band) g.band = r.band;
      groups.set(k, g);
    }
    g.items.push({ itemId: r.itemId, attempts: r.attempts, buckets: r.buckets, seconds: r.seconds });
  }

  return {
    generatedAt: new Date(opts.now).toISOString(),
    feedback: feedback.map(({ receivedAt: _r, comment, answer, ...f }) => ({
      kind: 'feedback' as const,
      ...f,
      ...(comment !== undefined ? { comment } : {}),
      ...(answer !== undefined ? { answer } : {}),
    })),
    stats: [...groups.values()],
    crashes: crashes.map(({ receivedAt: _r, stack, ...c }) => ({ kind: 'crash' as const, ...c, ...(stack !== undefined ? { stack } : {}) })),
    retention: retention(installs),
  };
}

/** Retention policy, run daily by the scheduled() handler. */
export function purge(storage: Storage, now: number): Promise<PurgeResult> {
  return storage.purge({
    crashesBefore: now - RETENTION.crashDays * DAY_MS,
    feedbackBefore: now - RETENTION.feedbackDays * DAY_MS,
    installsLastSeenBefore: isoDay(now - RETENTION.installIdleDays * DAY_MS),
  });
}

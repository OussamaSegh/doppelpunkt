// Anonymous item statistics: counts per item since the last upload, kept only while the learner
// opted in. Uploaded at most once a day, then the local aggregate is cleared.
import type { ItemStat, StatsBatch } from '@doppelpunkt/beta-schema';
import { estimateSkills } from '@doppelpunkt/engine';
import { db, todayKey, type AttemptRow, type ItemStatRow } from '../../db';
import { useContent } from '../../content';
import { APP_VERSION, collectorUrl, isOnline } from './config';
import { enqueue, flushOutbox } from './outbox';
import { ensureInstallId, getBeta, setLastStatsDay } from './prefs';

/** Time on one item is capped so a tab left open doesn't skew the numbers. */
const MAX_ITEM_SECONDS = 600;
const shownAt = new Map<string, number>();

/** Call when an exercise is shown; the next recorded attempt measures time from here. */
export function markShown(itemId: string, now = Date.now()): void {
  shownAt.set(itemId, now);
}

/** First-try score bucket: [0, 0.5) → 0, [0.5, 0.8) → 1, [0.8, 1] → 2. */
export function bucketOf(score: number): 0 | 1 | 2 {
  return score >= 0.8 ? 2 : score >= 0.5 ? 1 : 0;
}

/**
 * Adds one attempt to the local aggregate (after it was stored in `attempts`). The first attempt
 * the learner ever made on the item goes into the first-try buckets.
 */
export async function noteAttempt(itemId: string, score: number, now = Date.now()): Promise<void> {
  try {
    if (!collectorUrl() || !(await getBeta()).stats) return;
    const started = shownAt.get(itemId);
    shownAt.delete(itemId);
    const seconds = started ? Math.min(MAX_ITEM_SECONDS, Math.max(0, (now - started) / 1000)) : 0;
    const total = await db.attempts.where('exerciseId').equals(itemId).count();
    await db.transaction('rw', db.itemStats, async () => {
      const cur: ItemStatRow = (await db.itemStats.get(itemId)) ?? { itemId, attempts: 0, buckets: [0, 0, 0], seconds: 0 };
      const buckets: [number, number, number] = [...cur.buckets];
      if (total <= 1) buckets[bucketOf(score)] += 1;
      await db.itemStats.put({ itemId, attempts: cur.attempts + 1, buckets, seconds: cur.seconds + seconds });
    });
  } catch {
    // Statistics must never get in the way of learning.
  }
}

/** Overall working band from all attempts (the skill estimate over every skill at once), e.g. "A1+". */
export function overallBand(attempts: AttemptRow[]): string | undefined {
  if (!attempts.length) return undefined;
  const all = attempts.map((a) => ({ ...a, skill: 'reading' as const }));
  return estimateSkills(all).find((s) => s.skill === 'reading')?.band.slice(0, 4);
}

/** Items per StatsBatch (the schema allows 500; 200 keeps each envelope well under the 64 KB body limit). */
export const STATS_BATCH_ITEMS = 200;

export const roundTo5 = (seconds: number) => Math.round(seconds / 5) * 5;

export function toItemStat(row: ItemStatRow): ItemStat {
  return { itemId: row.itemId.slice(0, 120), attempts: row.attempts, buckets: row.buckets, seconds: roundTo5(row.seconds) };
}

export function buildStatsBatches(
  rows: ItemStatRow[],
  meta: { installId: string; band?: string; day: string; contentVersion: string },
): StatsBatch[] {
  const items = rows.filter((r) => r.attempts > 0).map(toItemStat);
  const out: StatsBatch[] = [];
  for (let i = 0; i < items.length; i += STATS_BATCH_ITEMS) {
    out.push({
      kind: 'stats',
      appVersion: APP_VERSION,
      contentVersion: meta.contentVersion.slice(0, 32) || 'unknown',
      installId: meta.installId,
      ...(meta.band ? { band: meta.band } : {}),
      day: meta.day,
      items: items.slice(i, i + STATS_BATCH_ITEMS),
    });
  }
  return out;
}

async function contentVersion(): Promise<string> {
  const loaded = useContent.getState().packs[0]?.version;
  if (loaded) return loaded;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}packs/index.json`);
    const idx = (await res.json()) as { packs?: Array<{ level: string; version: string }> };
    return idx.packs?.map((p) => p.version)[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Uploads the aggregate when the learner opted in, is online and nothing was uploaded today.
 * Returns true when a batch was queued.
 */
export async function maybeUploadStats(
  opts: { now?: Date; fetchImpl?: typeof fetch; contentVersion?: string } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  if (!collectorUrl() || !isOnline()) return false;
  const beta = await getBeta();
  const day = todayKey(now);
  if (!beta.stats || beta.lastStatsDay === day) return false;
  const rows = await db.itemStats.toArray();
  if (!rows.length) return false;
  const installId = await ensureInstallId(now);
  if (!installId) return false;
  const band = overallBand(await db.attempts.toArray());
  const batches = buildStatsBatches(rows, { installId, band, day, contentVersion: opts.contentVersion ?? (await contentVersion()) });
  await db.transaction('rw', db.outbox, db.itemStats, db.settings, async () => {
    for (const b of batches) await enqueue(b);
    await db.itemStats.clear();
    await setLastStatsDay(day);
  });
  await flushOutbox(opts.fetchImpl);
  return true;
}

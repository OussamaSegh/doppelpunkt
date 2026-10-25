// Beta opt-ins and the install id. Everything starts off; the install id exists only while the
// learner shares item statistics.
import { db, DEFAULT_BETA, getSettings, updateSettings, type BetaPrefs } from '../../db';
import { collectorUrl, INSTALL_ID_MAX_AGE_DAYS, isOnline } from './config';

const DAY_MS = 86_400_000;

export async function getBeta(): Promise<BetaPrefs> {
  return { ...DEFAULT_BETA, ...(await getSettings()).beta };
}

export function betaOf(settings: { beta?: BetaPrefs } | undefined): BetaPrefs {
  return { ...DEFAULT_BETA, ...settings?.beta };
}

async function patchBeta(patch: Partial<BetaPrefs>): Promise<BetaPrefs> {
  const next = { ...(await getBeta()), ...patch };
  for (const k of Object.keys(next) as Array<keyof BetaPrefs>) if (next[k] === undefined) delete next[k];
  await updateSettings({ beta: next });
  return next;
}

/** 32 lowercase hex characters from crypto.getRandomValues. */
export function newInstallId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The current install id, creating or rotating it (after 90 days) as needed. Only while stats are on. */
export async function ensureInstallId(now = new Date()): Promise<string | undefined> {
  const beta = await getBeta();
  if (!beta.stats) return undefined;
  const age = beta.installIdAt ? now.getTime() - Date.parse(beta.installIdAt) : Infinity;
  if (beta.installId && /^[a-f0-9]{32}$/.test(beta.installId) && age < INSTALL_ID_MAX_AGE_DAYS * DAY_MS && age >= 0) return beta.installId;
  const id = newInstallId();
  await patchBeta({ installId: id, installIdAt: now.toISOString() });
  return id;
}

/** Turns item statistics on (creates the install id) or off (deletes it, the local aggregate and queued batches, and asks the collector to forget it). */
export async function setStatsOptIn(on: boolean, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (on) {
    await patchBeta({ stats: true });
    await ensureInstallId();
    return;
  }
  const beta = await getBeta();
  const forget = [...(beta.pendingForget ?? []), ...(beta.installId ? [beta.installId] : [])];
  await db.transaction('rw', db.settings, db.itemStats, db.outbox, async () => {
    await db.itemStats.clear();
    await db.outbox.where('kind').equals('stats').delete();
    await patchBeta({ stats: false, installId: undefined, installIdAt: undefined, lastStatsDay: undefined, pendingForget: forget.length ? forget : undefined });
  });
  await sendPendingForget(fetchImpl);
}

/** Turns crash reports on or off; off also drops crash reports that were not sent yet. */
export async function setCrashOptIn(on: boolean): Promise<void> {
  if (!on) await db.outbox.where('kind').equals('crash').delete();
  await patchBeta({ crashes: on });
}

/** Marks the one-time beta card as answered. */
export async function finishBetaIntro(): Promise<void> {
  await patchBeta({ introDone: true });
}

export async function setLastStatsDay(day: string): Promise<void> {
  await patchBeta({ lastStatsDay: day });
}

/**
 * POST /v1/forget { installId } for every id the learner withdrew. Ids stay pending (and are
 * retried on the next sync) until the collector gives a final answer (2xx or 4xx).
 */
export async function sendPendingForget(fetchImpl: typeof fetch = fetch): Promise<void> {
  const base = collectorUrl();
  if (!base || !isOnline()) return;
  const pending = (await getBeta()).pendingForget ?? [];
  if (!pending.length) return;
  const left: string[] = [];
  for (const installId of pending) {
    try {
      const res = await fetchImpl(`${base}/v1/forget`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installId }),
        credentials: 'omit',
        keepalive: true,
      });
      // 2xx done; 4xx (bad or unknown id) can't succeed later either; retry timeouts, rate limits and 5xx.
      const final = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429);
      if (!final) left.push(installId);
    } catch {
      left.push(installId);
    }
  }
  const now = (await getBeta()).pendingForget ?? [];
  // Keep ids added while we were sending.
  const still = [...new Set([...left, ...now.filter((id) => !pending.includes(id))])];
  await patchBeta({ pendingForget: still.length ? still : undefined });
}

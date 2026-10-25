/**
 * Storage interface. The collector logic (src/collector.ts) only talks to this interface; the D1
 * implementation (src/storage-d1.ts) is a thin SQL mapping and the tests use the in-memory one
 * (src/storage-memory.ts). Columns: migrations/0001_init.sql.
 */

export interface FeedbackRow {
  /** Server receive time (ms), used for the retention policy and `since` filters. */
  receivedAt: number;
  appVersion: string;
  contentVersion: string;
  itemId: string;
  unitId: string;
  reason: 'wrong-answer' | 'unclear' | 'typo' | 'audio' | 'swiss-form' | 'other';
  comment?: string;
  answer?: string;
  at: string;
}

export interface CrashRow {
  receivedAt: number;
  appVersion: string;
  name: string;
  message: string;
  stack?: string;
  route: string;
  browser: string;
  at: string;
}

/**
 * One aggregate counter row. There is no install id: every upload is added onto the row for its
 * (item, content version, app version, band, day, cohort).
 */
export interface StatRow {
  itemId: string;
  contentVersion: string;
  appVersion: string;
  /** Level band, '' when the app sent none. */
  band: string;
  day: string;
  /** ISO week in which the uploading install was first seen, e.g. "2026-W43". */
  cohort: string;
  attempts: number;
  buckets: [number, number, number];
  seconds: number;
}

export interface InstallRow {
  /** HMAC of the install id under INSTALL_SECRET; the raw id is never stored. */
  hash: string;
  firstSeenDay: string;
  firstSeenWeek: string;
  lastSeenDay: string;
  /** Bitmap: bit k is set when the install uploaded in week k after its first week (bit 0 = first week). */
  activeWeeks: number;
}

export interface PurgeCutoffs {
  /** Delete crashes received before this time (ms). */
  crashesBefore: number;
  /** Delete feedback received before this time (ms). */
  feedbackBefore: number;
  /** Delete installs whose last upload day is before this ISO day. */
  installsLastSeenBefore: string;
}

export interface PurgeResult {
  crashes: number;
  feedback: number;
  installs: number;
}

export interface Storage {
  getInstall(hash: string): Promise<InstallRow | null>;
  putInstall(row: InstallRow): Promise<void>;
  /** Returns whether a row existed. */
  deleteInstall(hash: string): Promise<boolean>;
  listInstalls(): Promise<InstallRow[]>;

  addFeedback(rows: FeedbackRow[]): Promise<void>;
  addCrashes(rows: CrashRow[]): Promise<void>;
  /** Adds the counters onto existing rows with the same key, or creates them. */
  addStats(rows: StatRow[]): Promise<void>;

  listFeedback(sinceMs: number): Promise<FeedbackRow[]>;
  listCrashes(sinceMs: number): Promise<CrashRow[]>;
  listStats(sinceDay: string): Promise<StatRow[]>;

  purge(cutoffs: PurgeCutoffs): Promise<PurgeResult>;
}

export function statKey(r: Pick<StatRow, 'itemId' | 'contentVersion' | 'appVersion' | 'band' | 'day' | 'cohort'>): string {
  return JSON.stringify([r.itemId, r.contentVersion, r.appVersion, r.band, r.day, r.cohort]);
}

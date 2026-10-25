import type { CrashRow, FeedbackRow, InstallRow, PurgeCutoffs, PurgeResult, StatRow, Storage } from './storage';

/** D1 batches are sent in chunks so that one request never builds an unbounded batch. */
const CHUNK = 100;

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const num = (v: unknown): number => Number(v);
const opt = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

/** Thin SQL mapping of Storage onto Cloudflare D1. Schema: migrations/0001_init.sql. */
export class D1Storage implements Storage {
  constructor(private readonly db: D1Database) {}

  private async batch(stmts: D1PreparedStatement[]): Promise<void> {
    for (let i = 0; i < stmts.length; i += CHUNK) await this.db.batch(stmts.slice(i, i + CHUNK));
  }

  async getInstall(hash: string): Promise<InstallRow | null> {
    const r = await this.db.prepare('SELECT * FROM installs WHERE install_hash = ?').bind(hash).first<Row>();
    return r ? toInstall(r) : null;
  }

  async putInstall(r: InstallRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO installs (install_hash, first_seen_day, first_seen_week, last_seen_day, active_weeks) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (install_hash) DO UPDATE SET last_seen_day = excluded.last_seen_day, active_weeks = excluded.active_weeks`,
      )
      .bind(r.hash, r.firstSeenDay, r.firstSeenWeek, r.lastSeenDay, r.activeWeeks)
      .run();
  }

  async deleteInstall(hash: string): Promise<boolean> {
    const res = await this.db.prepare('DELETE FROM installs WHERE install_hash = ?').bind(hash).run();
    return (res.meta.changes ?? 0) > 0;
  }

  async listInstalls(): Promise<InstallRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM installs').all<Row>();
    return results.map(toInstall);
  }

  async addFeedback(rows: FeedbackRow[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO feedback (received_at, app_version, content_version, item_id, unit_id, reason, comment, answer, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await this.batch(rows.map((r) => stmt.bind(r.receivedAt, r.appVersion, r.contentVersion, r.itemId, r.unitId, r.reason, r.comment ?? null, r.answer ?? null, r.at)));
  }

  async addCrashes(rows: CrashRow[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO crashes (received_at, app_version, name, message, stack, route, browser, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await this.batch(rows.map((r) => stmt.bind(r.receivedAt, r.appVersion, r.name, r.message, r.stack ?? null, r.route, r.browser, r.at)));
  }

  async addStats(rows: StatRow[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO item_stats (item_id, content_version, app_version, band, day, cohort, attempts, bucket_low, bucket_mid, bucket_high, seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id, content_version, app_version, band, day, cohort) DO UPDATE SET
         attempts = attempts + excluded.attempts,
         bucket_low = bucket_low + excluded.bucket_low,
         bucket_mid = bucket_mid + excluded.bucket_mid,
         bucket_high = bucket_high + excluded.bucket_high,
         seconds = seconds + excluded.seconds`,
    );
    await this.batch(
      rows.map((r) => stmt.bind(r.itemId, r.contentVersion, r.appVersion, r.band, r.day, r.cohort, r.attempts, r.buckets[0], r.buckets[1], r.buckets[2], r.seconds)),
    );
  }

  async listFeedback(sinceMs: number): Promise<FeedbackRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM feedback WHERE received_at >= ? ORDER BY id').bind(sinceMs).all<Row>();
    return results.map((r) => ({
      receivedAt: num(r.received_at),
      appVersion: str(r.app_version),
      contentVersion: str(r.content_version),
      itemId: str(r.item_id),
      unitId: str(r.unit_id),
      reason: str(r.reason) as FeedbackRow['reason'],
      comment: opt(r.comment),
      answer: opt(r.answer),
      at: str(r.at),
    }));
  }

  async listCrashes(sinceMs: number): Promise<CrashRow[]> {
    const { results } = await this.db.prepare('SELECT * FROM crashes WHERE received_at >= ? ORDER BY id').bind(sinceMs).all<Row>();
    return results.map((r) => ({
      receivedAt: num(r.received_at),
      appVersion: str(r.app_version),
      name: str(r.name),
      message: str(r.message),
      stack: opt(r.stack),
      route: str(r.route),
      browser: str(r.browser),
      at: str(r.at),
    }));
  }

  async listStats(sinceDay: string): Promise<StatRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM item_stats WHERE day >= ? ORDER BY day, app_version, content_version, band, cohort, item_id')
      .bind(sinceDay)
      .all<Row>();
    return results.map((r) => ({
      itemId: str(r.item_id),
      contentVersion: str(r.content_version),
      appVersion: str(r.app_version),
      band: str(r.band),
      day: str(r.day),
      cohort: str(r.cohort),
      attempts: num(r.attempts),
      buckets: [num(r.bucket_low), num(r.bucket_mid), num(r.bucket_high)],
      seconds: num(r.seconds),
    }));
  }

  async purge(c: PurgeCutoffs): Promise<PurgeResult> {
    const [crashes, feedback, installs] = await this.db.batch([
      this.db.prepare('DELETE FROM crashes WHERE received_at < ?').bind(c.crashesBefore),
      this.db.prepare('DELETE FROM feedback WHERE received_at < ?').bind(c.feedbackBefore),
      this.db.prepare('DELETE FROM installs WHERE last_seen_day < ?').bind(c.installsLastSeenBefore),
    ]);
    return { crashes: crashes?.meta.changes ?? 0, feedback: feedback?.meta.changes ?? 0, installs: installs?.meta.changes ?? 0 };
  }
}

function toInstall(r: Row): InstallRow {
  return {
    hash: str(r.install_hash),
    firstSeenDay: str(r.first_seen_day),
    firstSeenWeek: str(r.first_seen_week),
    lastSeenDay: str(r.last_seen_day),
    activeWeeks: num(r.active_weeks),
  };
}

import type { CrashRow, FeedbackRow, InstallRow, PurgeCutoffs, PurgeResult, StatRow, Storage } from './storage';
import { statKey } from './storage';

/** In-memory Storage, for tests and local experiments. Same semantics as the D1 implementation. */
export class MemoryStorage implements Storage {
  readonly installs = new Map<string, InstallRow>();
  feedback: FeedbackRow[] = [];
  crashes: CrashRow[] = [];
  readonly stats = new Map<string, StatRow>();

  async getInstall(hash: string): Promise<InstallRow | null> {
    const row = this.installs.get(hash);
    return row ? { ...row } : null;
  }

  async putInstall(row: InstallRow): Promise<void> {
    this.installs.set(row.hash, { ...row });
  }

  async deleteInstall(hash: string): Promise<boolean> {
    return this.installs.delete(hash);
  }

  async listInstalls(): Promise<InstallRow[]> {
    return [...this.installs.values()].map((r) => ({ ...r }));
  }

  async addFeedback(rows: FeedbackRow[]): Promise<void> {
    this.feedback.push(...rows.map((r) => ({ ...r })));
  }

  async addCrashes(rows: CrashRow[]): Promise<void> {
    this.crashes.push(...rows.map((r) => ({ ...r })));
  }

  async addStats(rows: StatRow[]): Promise<void> {
    for (const r of rows) {
      const k = statKey(r);
      const cur = this.stats.get(k);
      if (!cur) {
        this.stats.set(k, { ...r, buckets: [...r.buckets] });
        continue;
      }
      cur.attempts += r.attempts;
      cur.seconds += r.seconds;
      cur.buckets = [cur.buckets[0] + r.buckets[0], cur.buckets[1] + r.buckets[1], cur.buckets[2] + r.buckets[2]];
    }
  }

  async listFeedback(sinceMs: number): Promise<FeedbackRow[]> {
    return this.feedback.filter((r) => r.receivedAt >= sinceMs).map((r) => ({ ...r }));
  }

  async listCrashes(sinceMs: number): Promise<CrashRow[]> {
    return this.crashes.filter((r) => r.receivedAt >= sinceMs).map((r) => ({ ...r }));
  }

  async listStats(sinceDay: string): Promise<StatRow[]> {
    return [...this.stats.values()].filter((r) => r.day >= sinceDay).map((r) => ({ ...r, buckets: [...r.buckets] }));
  }

  async purge(c: PurgeCutoffs): Promise<PurgeResult> {
    const before = { crashes: this.crashes.length, feedback: this.feedback.length };
    this.crashes = this.crashes.filter((r) => r.receivedAt >= c.crashesBefore);
    this.feedback = this.feedback.filter((r) => r.receivedAt >= c.feedbackBefore);
    let installs = 0;
    for (const [k, r] of this.installs) {
      if (r.lastSeenDay < c.installsLastSeenBefore) {
        this.installs.delete(k);
        installs++;
      }
    }
    return { crashes: before.crashes - this.crashes.length, feedback: before.feedback - this.feedback.length, installs };
  }
}

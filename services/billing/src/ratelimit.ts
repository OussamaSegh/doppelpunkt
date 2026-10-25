/**
 * Per-client rate limit for the endpoints that could be brute-forced (redeem, restore, claim) or
 * abused (checkout). The key is an HMAC of (CF-Connecting-IP, UTC day) under HASH_SECRET, kept
 * only in memory for one window; the IP itself is never stored or logged.
 */
export class MemoryRateLimiter {
  private readonly counts = new Map<string, { n: number; resetAt: number }>();

  hit(key: string, limit: number, windowMs: number, now: number): boolean {
    if (this.counts.size > 10_000) for (const [k, v] of this.counts) if (v.resetAt <= now) this.counts.delete(k);
    const cur = this.counts.get(key);
    if (!cur || cur.resetAt <= now) {
      this.counts.set(key, { n: 1, resetAt: now + windowMs });
      return limit >= 1;
    }
    cur.n++;
    return cur.n <= limit;
  }
}

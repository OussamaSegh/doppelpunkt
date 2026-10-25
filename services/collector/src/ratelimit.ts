/**
 * Rate limiting per client. The client key is a short HMAC of (CF-Connecting-IP, UTC day) under
 * RATE_SALT, computed per request and kept only in memory or in KV with a TTL of one window.
 * The IP address itself is never stored or logged, and the key changes every day.
 */

export interface RateLimiter {
  /** Counts one request for `key`; returns false when the key is over `limit` in the current window. */
  hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean>;
}

/** Per-isolate memory counter. Cloudflare runs several isolates, so the limit is approximate. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { n: number; resetAt: number }>();

  async hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
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

/** The part of a Workers KV namespace the limiter uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

/** Optional KV-backed counter, shared between isolates (eventually consistent, so still approximate). */
export class KvRateLimiter implements RateLimiter {
  constructor(private readonly kv: KvLike) {}

  async hit(key: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const k = `rl:${key}:${Math.floor(now / windowMs)}`;
    const n = Number((await this.kv.get(k)) ?? '0') + 1;
    await this.kv.put(k, String(n), { expirationTtl: Math.max(60, Math.ceil(windowMs / 1000)) });
    return n <= limit;
  }
}

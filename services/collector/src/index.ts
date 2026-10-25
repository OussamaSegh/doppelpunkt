/**
 * Doppelpunkt beta collector: an optional Cloudflare Worker with D1 storage that receives the
 * opt-in beta envelopes defined in @doppelpunkt/beta-schema (feedback, item stats, crashes).
 * Routes and behaviour: src/http.ts. It never stores or logs IP addresses, raw install ids or
 * request bodies. See docs/PRIVACY.md.
 */
import { purge } from './collector';
import { handle, type Config, type Deps } from './http';
import { KvRateLimiter, MemoryRateLimiter } from './ratelimit';
import { D1Storage } from './storage-d1';

export { FORGET_PATH, MAX_BODY_BYTES, clientKey, handle, type Config, type Deps } from './http';

export interface Env extends Config {
  DB: D1Database;
  /** Optional KV namespace for a rate limit shared between isolates. */
  RATE_LIMIT_KV?: KVNamespace;
}

/** Kept per isolate so that the in-memory rate limit spans requests. */
const memoryLimiter = new MemoryRateLimiter();

function deps(env: Env): Deps {
  return { storage: new D1Storage(env.DB), limiter: env.RATE_LIMIT_KV ? new KvRateLimiter(env.RATE_LIMIT_KV) : memoryLimiter };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, deps(env));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(purge(new D1Storage(env.DB), controller.scheduledTime).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

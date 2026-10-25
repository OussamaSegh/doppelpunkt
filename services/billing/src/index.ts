/**
 * Doppelpunkt billing: an optional Cloudflare Worker with a D1 database that sells level unlocks
 * through Stripe Checkout and redeems book access codes, issuing Ed25519-signed license tokens
 * that the app verifies offline (packages/license). Routes: src/http.ts. Setup: docs/PAYMENTS.md.
 */
import { handle, type Config } from './http';
import { MemoryRateLimiter } from './ratelimit';
import { D1Storage, type D1Like } from './storage-d1';

export { handle, prices, type Config, type Deps } from './http';
export { MemoryStorage } from './storage-memory';
export { D1Storage } from './storage-d1';
export { signWebhook, verifyWebhook } from './stripe';
export { codeHash, emailHash } from './crypto';

export interface Env extends Config {
  DB: D1Like;
}

const limiter = new MemoryRateLimiter();

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { storage: new D1Storage(env.DB), limiter });
  },
};

/**
 * HTTP layer of the beta collector, free of Cloudflare types so that other workspaces (the web
 * app's contract test) can drive it with any Storage. The Worker entry point is src/index.ts.
 *
 *   POST /v1/ingest   one BetaEnvelope or an array of up to 50 -> { accepted, rejected }
 *   POST /v1/forget   { installId } -> removes that install's row (opt-out)
 *   GET  /v1/export   Authorization: Bearer EXPORT_TOKEN -> ExportDump   (?since=YYYY-MM-DD)
 *   GET  /v1/health
 *
 * It never stores or logs IP addresses, raw install ids or request bodies. See docs/PRIVACY.md.
 */
import { ENDPOINTS } from '@doppelpunkt/beta-schema';
import { MAX_ENVELOPES, buildExport, forget, ingest } from './collector';
import { hmacHex, safeEqual } from './crypto';
import type { RateLimiter } from './ratelimit';
import type { Storage } from './storage';
import { dayNumber, isoDay } from './time';

export const FORGET_PATH = '/v1/forget';
export const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 3_600_000;
const DEFAULT_RATE_LIMIT = 120;

/** Settings from wrangler.toml [vars] and secrets. */
export interface Config {
  /** Comma-separated allowed origins. Empty = any origin. */
  ALLOWED_ORIGINS?: string;
  /** Secret for hashing install ids (wrangler secret). Required for ingest and forget. */
  INSTALL_SECRET?: string;
  /** Secret salt for the short-lived rate-limit key (wrangler secret). Required for ingest and forget. */
  RATE_SALT?: string;
  /** Bearer token for GET /v1/export (wrangler secret). Unset = export disabled. */
  EXPORT_TOKEN?: string;
  /** Requests per client per hour on ingest and forget. Default 120. */
  RATE_LIMIT_PER_HOUR?: string;
}

export interface Deps {
  storage: Storage;
  limiter: RateLimiter;
  now?: () => number;
}

function allowedOrigin(origin: string | null, env: Config): string | null | undefined {
  if (origin === null) return undefined; // not a browser request; CORS doesn't apply
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length || list.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin: string | undefined): Headers {
  const h = new Headers();
  if (origin === undefined) return h;
  h.set('access-control-allow-origin', origin);
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  h.set('access-control-allow-headers', 'content-type, authorization');
  h.set('access-control-expose-headers', 'retry-after');
  h.set('access-control-max-age', '86400');
  h.set('vary', 'Origin');
  return h;
}

function json(status: number, body: unknown, cors?: Headers, extra?: Record<string, string>): Response {
  const h = new Headers(cors);
  h.set('content-type', 'application/json');
  h.set('cache-control', 'no-store');
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v);
  return new Response(JSON.stringify(body), { status, headers: h });
}

const error = (status: number, message: string, cors?: Headers, extra?: Record<string, string>) => json(status, { error: { message } }, cors, extra);

class TooLarge extends Error {}

/** Reads the body as text, stopping as soon as it exceeds `limit` bytes (Content-Length is not trusted). */
async function readText(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > limit) throw new TooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  let text: string;
  try {
    text = await readText(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof TooLarge) return { ok: false, status: 413, message: `Body larger than ${MAX_BODY_BYTES} bytes` };
    return { ok: false, status: 400, message: 'Could not read the body' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, message: 'Body is not valid JSON' };
  }
}

/** Short-lived client key: HMAC(RATE_SALT, ip + day). Never stored beyond one rate window. */
export function clientKey(request: Request, salt: string, now: number): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return hmacHex(salt, `${ip}|${isoDay(now)}`, 24);
}

export async function handle(request: Request, env: Config, deps: Deps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const origin = allowedOrigin(request.headers.get('origin'), env);
  if (origin === null) return error(403, 'Origin not allowed by this collector');
  const cors = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const { pathname, searchParams } = new URL(request.url);

  if (pathname === ENDPOINTS.health || pathname === '/') {
    if (request.method !== 'GET') return error(405, 'Method not allowed', cors, { allow: 'GET' });
    return json(200, { ok: true, service: 'doppelpunkt-collector', configured: Boolean(env.INSTALL_SECRET && env.RATE_SALT) }, cors);
  }

  if (pathname === ENDPOINTS.export) {
    if (request.method !== 'GET') return error(405, 'Method not allowed', cors, { allow: 'GET' });
    if (!env.EXPORT_TOKEN) return error(404, 'Export is disabled on this collector', cors);
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !(await safeEqual(token, env.EXPORT_TOKEN))) return error(401, 'Missing or wrong export token', cors, { 'www-authenticate': 'Bearer' });
    const since = searchParams.get('since') ?? undefined;
    if (since !== undefined && Number.isNaN(dayNumber(since))) return error(400, 'since must be an ISO date (YYYY-MM-DD)', cors);
    try {
      return json(200, await buildExport(deps.storage, { now, sinceDay: since }), cors);
    } catch {
      return error(503, 'Storage unavailable', cors);
    }
  }

  if (pathname === ENDPOINTS.ingest || pathname === FORGET_PATH) {
    if (request.method !== 'POST') return error(405, 'Method not allowed', cors, { allow: 'POST, OPTIONS' });
    if (!env.INSTALL_SECRET || !env.RATE_SALT) return error(503, 'Collector is not configured (INSTALL_SECRET, RATE_SALT)', cors);

    const limit = Number(env.RATE_LIMIT_PER_HOUR) > 0 ? Number(env.RATE_LIMIT_PER_HOUR) : DEFAULT_RATE_LIMIT;
    const key = await clientKey(request, env.RATE_SALT, now);
    if (!(await deps.limiter.hit(key, limit, RATE_WINDOW_MS, now))) {
      const retryAfter = Math.ceil((RATE_WINDOW_MS - (now % RATE_WINDOW_MS)) / 1000);
      return error(429, 'Too many requests', cors, { 'retry-after': String(retryAfter) });
    }

    const body = await readJson(request);
    if (!body.ok) return error(body.status, body.message, cors);

    if (pathname === FORGET_PATH) {
      const installId = typeof body.value === 'object' && body.value !== null ? (body.value as { installId?: unknown }).installId : undefined;
      try {
        if (!(await forget(deps.storage, installId, env.INSTALL_SECRET))) return error(400, 'installId must be 32 lowercase hex characters', cors);
      } catch {
        return error(503, 'Storage unavailable', cors);
      }
      return json(200, { ok: true }, cors);
    }

    const list = Array.isArray(body.value) ? body.value : [body.value];
    if (list.length > MAX_ENVELOPES) return error(413, `At most ${MAX_ENVELOPES} envelopes per request`, cors);
    try {
      return json(200, await ingest(deps.storage, list, { installSecret: env.INSTALL_SECRET, now }), cors);
    } catch {
      return error(503, 'Storage unavailable; try again later', cors, { 'retry-after': '300' });
    }
  }

  return error(404, 'Not found', cors);
}


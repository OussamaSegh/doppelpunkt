/**
 * Doppelpunkt relay: an optional, stateless Cloudflare Worker that forwards AI requests from the
 * browser to the provider when a provider blocks direct browser calls (CORS).
 *
 *   /anthropic/*  -> https://api.anthropic.com/*
 *   /openai/*     -> https://api.openai.com/*
 *   /gemini/*     -> https://generativelanguage.googleapis.com/*
 *   /xai/*        -> https://api.x.ai/*
 *
 * It never logs, stores or inspects request/response bodies or API keys. Only an allowlist of
 * headers is forwarded in each direction. The response body is streamed straight through.
 */

export interface Env {
  /** Optional comma-separated list of allowed origins, e.g. "https://doppelpunkt.app,http://localhost:5173". Empty = any origin. */
  ALLOWED_ORIGINS?: string;
}

export const UPSTREAMS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  xai: 'https://api.x.ai',
};

/** Request headers passed to the provider. Everything else (cookies, origin, cf-*, x-forwarded-*) is dropped. */
export const REQUEST_HEADER_ALLOWLIST = [
  'content-type',
  'accept',
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'openai-organization',
  'openai-project',
];

/** Response headers passed back to the browser. */
export const RESPONSE_HEADER_ALLOWLIST = [
  'content-type',
  'cache-control',
  'retry-after',
  'request-id',
  'x-request-id',
];

const ALLOWED_METHODS = 'GET, POST, OPTIONS';

function allowedOrigin(origin: string | null, env: Env): string | null {
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return origin ?? '*';
  if (origin && list.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin: string): Headers {
  const h = new Headers();
  h.set('access-control-allow-origin', origin);
  h.set('access-control-allow-methods', ALLOWED_METHODS);
  h.set('access-control-allow-headers', REQUEST_HEADER_ALLOWLIST.join(', '));
  h.set('access-control-expose-headers', RESPONSE_HEADER_ALLOWLIST.join(', '));
  h.set('access-control-max-age', '86400');
  if (origin !== '*') h.set('vary', 'Origin');
  return h;
}

function plain(status: number, message: string, cors?: Headers): Response {
  const h = new Headers(cors);
  h.set('content-type', 'application/json');
  return new Response(JSON.stringify({ error: { message } }), { status, headers: h });
}

export async function handle(request: Request, env: Env = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const origin = allowedOrigin(request.headers.get('origin'), env);
  if (origin === null) return plain(403, 'Origin not allowed by this relay');
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST' && request.method !== 'GET') return plain(405, 'Method not allowed', cors);

  const url = new URL(request.url);
  const match = url.pathname.match(/^\/([a-z]+)\/(.+)$/);
  const base = match ? UPSTREAMS[match[1]!] : undefined;
  if (!match || !base) {
    if (url.pathname === '/' || url.pathname === '/health') return plain(200, 'Doppelpunkt relay. Use /anthropic/*, /openai/*, /gemini/* or /xai/*.', cors);
    return plain(404, 'Unknown provider path', cors);
  }
  const target = `${base}/${match[2]}${url.search}`;

  const headers = new Headers();
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const v = request.headers.get(name);
    if (v !== null) headers.set(name, v);
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : request.body,
      redirect: 'manual',
      // Required by some runtimes when streaming a request body.
      ...(request.method === 'GET' ? {} : { duplex: 'half' }),
    } as RequestInit);
  } catch {
    return plain(502, 'The relay could not reach the provider', cors);
  }

  const out = new Headers(cors);
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const v = upstream.headers.get(name);
    if (v !== null) out.set(name, v);
  }
  for (const [k, v] of upstream.headers) if (k.startsWith('anthropic-ratelimit-') || k.startsWith('x-ratelimit-')) out.set(k, v);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};

/**
 * HTTP layer of the billing Worker (entry: src/index.ts).
 *
 *   POST /v1/checkout  { sku }                    -> { url, sessionId, pid }   Stripe Checkout redirect
 *   POST /v1/claim     { sessionId }              -> { token, pid, sku }       after the Stripe redirect (202 while unpaid)
 *   POST /v1/webhook   Stripe event, signed       -> { received: true }        checkout.session.completed / async_payment_succeeded, charge.refunded
 *   POST /v1/redeem    { code }                   -> { token, pid, sku }       book access code
 *   POST /v1/restore   { email, reference }       -> { token, pid, sku }       reference = purchase id (dp_…) or session id (cs_…)
 *   GET  /v1/health                               -> { ok, service, configured }
 *
 * Stores no names, plaintext emails, card data or IP addresses. See docs/PAYMENTS.md.
 */
import { productFor, SOLD_PRODUCTS, newPurchaseId } from '@doppelpunkt/license';
import { FulfilError, findForRestore, fulfil, isPaid, redeem, signer, type Signer } from './billing';
import { hmacHex } from './crypto';
import type { MemoryRateLimiter } from './ratelimit';
import type { Storage } from './storage';
import { Stripe, StripeError, verifyWebhook, type CheckoutSession } from './stripe';

export const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 3_600_000;
const DEFAULT_RATE_LIMIT = 30;

/** wrangler.toml [vars] and secrets. */
export interface Config {
  /** Comma-separated app origins allowed to call the API from a browser. Empty = any. */
  ALLOWED_ORIGINS?: string;
  /** The app's public URL with a trailing slash, e.g. https://example.org/doppelpunkt/ (Stripe redirects there). */
  APP_URL?: string;
  /** Secret: Stripe secret key (sk_live_… / sk_test_…), or a restricted key with Checkout Sessions write. */
  STRIPE_SECRET_KEY?: string;
  /** Secret: signing secret of the webhook endpoint (whsec_…). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** JSON object sku -> Stripe Price id, e.g. {"level-a2":"price_123","pass-year":"price_456"}. */
  STRIPE_PRICES?: string;
  /** Secret: Ed25519 private key, PKCS#8 base64url (npm run keygen -w @doppelpunkt/license). */
  LICENSE_PRIVATE_KEY?: string;
  /** Key id that the app knows the public key under (VITE_LICENSE_PUBLIC_KEYS). */
  LICENSE_KEY_ID?: string;
  /** "1" allows signing with the public TEST key (local development only). */
  ALLOW_TEST_KEY?: string;
  /** Secret: keys the hashes of emails, book codes and rate-limit keys. Keep it stable. */
  HASH_SECRET?: string;
  /** Requests per client per hour on the POST endpoints except the webhook. Default 30. */
  RATE_LIMIT_PER_HOUR?: string;
}

export interface Deps {
  storage: Storage;
  limiter: MemoryRateLimiter;
  fetch?: typeof fetch;
  now?: () => number;
}

function allowedOrigin(origin: string | null, env: Config): string | null | undefined {
  if (origin === null) return undefined;
  const list = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return !list.length || list.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | undefined): Headers {
  const h = new Headers();
  if (origin === undefined) return h;
  h.set('access-control-allow-origin', origin);
  h.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  h.set('access-control-allow-headers', 'content-type');
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

async function readText(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > MAX_BODY_BYTES ? null : text;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function prices(env: Config): Record<string, string> {
  try {
    const v: unknown = JSON.parse(env.STRIPE_PRICES ?? '{}');
    if (typeof v !== 'object' || v === null) return {};
    return Object.fromEntries(Object.entries(v).filter(([sku, id]) => typeof id === 'string' && /^price_\w+$/.test(id) && productFor(sku)?.price));
  } catch {
    return {};
  }
}

function signerFor(env: Config): Signer | undefined {
  const kid = env.LICENSE_KEY_ID?.trim();
  if (!kid || !env.LICENSE_PRIVATE_KEY) return undefined;
  if (kid === 'test' && env.ALLOW_TEST_KEY !== '1') return undefined;
  return signer(kid, env.LICENSE_PRIVATE_KEY);
}

function appUrl(env: Config): string | undefined {
  try {
    const u = new URL(env.APP_URL ?? '');
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return undefined;
    return u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    return undefined;
  }
}

const tokenBody = (row: { token: string; pid: string; sku: string }) => ({ token: row.token, pid: row.pid, sku: row.sku });

export async function handle(request: Request, env: Config, deps: Deps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const { pathname } = new URL(request.url);
  const fetchImpl = deps.fetch ?? fetch;
  const s = signerFor(env);
  const configured = {
    checkout: Boolean(env.STRIPE_SECRET_KEY && appUrl(env) && Object.keys(prices(env)).length),
    webhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
    signing: Boolean(s),
    hashing: Boolean(env.HASH_SECRET),
  };

  // Stripe calls the webhook server to server: no Origin, no CORS, own authentication.
  if (pathname === '/v1/webhook') {
    if (request.method !== 'POST') return error(405, 'Method not allowed', undefined, { allow: 'POST' });
    if (!env.STRIPE_WEBHOOK_SECRET || !s || !env.HASH_SECRET) return error(503, 'Webhook is not configured');
    const raw = await readText(request);
    if (raw === null) return error(413, 'Body too large');
    const check = await verifyWebhook(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET, now);
    if (!check.ok) return error(400, `Invalid webhook (${check.reason})`);
    const { event } = check;
    try {
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object as unknown as CheckoutSession;
        // Unpaid (e.g. a bank transfer still pending) arrives again as async_payment_succeeded.
        if (isPaid(session) && productFor(session.metadata?.sku ?? '')) await fulfil(deps.storage, session, { signer: s, hashSecret: env.HASH_SECRET });
      } else if (event.type === 'charge.refunded') {
        const charge = event.data.object as { refunded?: boolean; payment_intent?: string | null };
        if (charge.refunded && typeof charge.payment_intent === 'string') await deps.storage.setStatusByPaymentIntent(charge.payment_intent, 'refunded');
      }
    } catch (e) {
      if (e instanceof FulfilError) return json(200, { received: true, ignored: e.message });
      return error(500, 'Could not process the event; Stripe will retry');
    }
    return json(200, { received: true });
  }

  const origin = allowedOrigin(request.headers.get('origin'), env);
  if (origin === null) return error(403, 'Origin not allowed');
  const cors = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (pathname === '/v1/health' || pathname === '/') {
    if (request.method !== 'GET') return error(405, 'Method not allowed', cors, { allow: 'GET' });
    return json(200, { ok: true, service: 'doppelpunkt-billing', configured }, cors);
  }

  const routes = ['/v1/checkout', '/v1/claim', '/v1/redeem', '/v1/restore'];
  if (!routes.includes(pathname)) return error(404, 'Not found', cors);
  if (request.method !== 'POST') return error(405, 'Method not allowed', cors, { allow: 'POST, OPTIONS' });
  if (!s || !env.HASH_SECRET) return error(503, 'Billing is not configured (LICENSE_PRIVATE_KEY, LICENSE_KEY_ID, HASH_SECRET)', cors);

  const limit = Number(env.RATE_LIMIT_PER_HOUR) > 0 ? Number(env.RATE_LIMIT_PER_HOUR) : DEFAULT_RATE_LIMIT;
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `${pathname}|${(await hmacHex(env.HASH_SECRET, `rate:${ip}|${day}`)).slice(0, 24)}`;
  if (!deps.limiter.hit(key, limit, RATE_WINDOW_MS, now)) {
    return error(429, 'Too many requests. Try again later.', cors, { 'retry-after': String(Math.ceil((RATE_WINDOW_MS - (now % RATE_WINDOW_MS)) / 1000)) });
  }

  const raw = await readText(request);
  if (raw === null) return error(413, 'Body too large', cors);
  const body = parseObject(raw);
  if (!body) return error(400, 'Body must be a JSON object', cors);

  const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, fetchImpl) : undefined;
  const retrieve = async (id: string): Promise<CheckoutSession | null> => {
    if (!stripe) return null;
    try {
      return await stripe.retrieveCheckoutSession(id);
    } catch (e) {
      if (e instanceof StripeError && e.status === 404) return null;
      throw e;
    }
  };

  try {
    switch (pathname) {
      case '/v1/checkout': {
        const app = appUrl(env);
        const sku = typeof body.sku === 'string' ? body.sku : '';
        const product = SOLD_PRODUCTS.find((p) => p.sku === sku);
        const price = prices(env)[sku];
        if (!stripe || !app) return error(503, 'Checkout is not configured (STRIPE_SECRET_KEY, APP_URL)', cors);
        if (!product) return error(400, 'Unknown product', cors);
        if (!price) return error(503, `No Stripe price configured for ${sku}`, cors);
        const pid = newPurchaseId();
        const session = await stripe.createCheckoutSession(
          {
            mode: 'payment',
            line_items: [{ price, quantity: 1 }],
            client_reference_id: pid,
            metadata: { pid, sku },
            // Shown on the Stripe receipt, so the learner has the purchase id for "restore".
            payment_intent_data: { description: `Doppelpunkt: ${product.name} (purchase ${pid})`, metadata: { pid, sku } },
            success_url: `${app}unlock/done?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${app}unlock?cancelled=1`,
            locale: 'auto',
          },
          `checkout-${pid}`,
        );
        if (!session.url) return error(502, 'Stripe returned no checkout URL', cors);
        return json(200, { url: session.url, sessionId: session.id, pid }, cors);
      }
      case '/v1/claim': {
        const id = typeof body.sessionId === 'string' ? body.sessionId : '';
        if (!/^cs_\w{8,200}$/.test(id)) return error(400, 'sessionId must be a Stripe Checkout session id (cs_…)', cors);
        let row = await deps.storage.getPurchaseBySession(id);
        if (!row) {
          const session = await retrieve(id);
          if (!session) return error(404, 'No such checkout session', cors);
          if (!isPaid(session)) return json(202, { pending: true, status: session.status, paymentStatus: session.payment_status }, cors);
          row = await fulfil(deps.storage, session, { signer: s, hashSecret: env.HASH_SECRET });
        }
        if (row.status === 'refunded') return error(410, 'This purchase was refunded', cors);
        return json(200, tokenBody(row), cors);
      }
      case '/v1/redeem': {
        const r = await redeem(deps.storage, body.code, { signer: s, hashSecret: env.HASH_SECRET, now });
        if (!r.ok) return error(r.status, r.message, cors);
        return json(200, { token: r.token, pid: r.pid, sku: (await deps.storage.getPurchase(r.pid))?.sku ?? '' }, cors);
      }
      case '/v1/restore': {
        const email = typeof body.email === 'string' ? body.email : '';
        const reference = typeof body.reference === 'string' ? body.reference : '';
        if (!/^[^\s@]{1,128}@[^\s@]{1,253}$/.test(email.trim()) || !/^(dp_[0-9a-z]{20}|cs_\w{8,200})$/i.test(reference.trim())) {
          return error(400, 'Send the email address used at checkout and the purchase id (dp_…) or checkout session id (cs_…).', cors);
        }
        const row = await findForRestore(deps.storage, email, reference, { hashSecret: env.HASH_SECRET, retrieve, signer: s });
        // Same answer for "no such purchase" and "wrong email", so the endpoint can't be used to test emails.
        if (!row) return error(404, 'No purchase matches this email address and reference.', cors);
        if (row.status === 'refunded') return error(410, 'This purchase was refunded', cors);
        return json(200, tokenBody(row), cors);
      }
    }
  } catch (e) {
    if (e instanceof StripeError) return error(502, `Stripe: ${e.message}`, cors);
    return error(503, 'Billing is temporarily unavailable', cors, { 'retry-after': '60' });
  }
  return error(404, 'Not found', cors);
}


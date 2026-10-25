/**
 * The small part of the Stripe REST API the Worker uses, with plain fetch (no SDK):
 * create and retrieve Checkout Sessions, and verify webhook signatures.
 * https://docs.stripe.com/api/checkout/sessions  https://docs.stripe.com/webhooks#verify-manually
 */
import { hex, safeEqual } from './crypto';

export const STRIPE_API = 'https://api.stripe.com';
/** Pinned API version, so a Stripe-side default change can't alter the response shape. */
export const STRIPE_VERSION = '2025-06-30.basil';
/** Webhook timestamps older than this are rejected (replay protection), as Stripe's libraries do. */
export const WEBHOOK_TOLERANCE_S = 300;

export type CheckoutSession = {
  id: string;
  object: 'checkout.session';
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  client_reference_id: string | null;
  metadata: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
  payment_intent?: string | { id: string } | null;
  created: number;
  url?: string | null;
};

export type StripeEvent = { id: string; type: string; created: number; data: { object: Record<string, unknown> } };

export class StripeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Flattens nested params into Stripe's form encoding: a[b][0][c]=v. */
export function formEncode(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}[${k}]` : k, x);
    else out.append(prefix, String(v));
  };
  walk('', params);
  return out.toString();
}

export class Stripe {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.secretKey}`, 'stripe-version': STRIPE_VERSION };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let body: string | undefined;
    if (params) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = formEncode(params);
    }
    const res = await this.fetchImpl(`${STRIPE_API}${path}`, { method, headers, body });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new StripeError(res.status, data.error?.message ?? `Stripe HTTP ${res.status}`);
    return data as T;
  }

  createCheckoutSession(params: Record<string, unknown>, idempotencyKey?: string): Promise<CheckoutSession> {
    return this.call<CheckoutSession>('POST', '/v1/checkout/sessions', params, idempotencyKey);
  }

  retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
    return this.call<CheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`);
  }
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

export type WebhookCheck = { ok: true; event: StripeEvent } | { ok: false; reason: 'header' | 'timestamp' | 'signature' | 'payload' };

/**
 * Verifies `Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>…]` against the raw body:
 * HMAC-SHA-256(webhook secret, "<t>.<body>") must equal one of the v1 values, and t must be within
 * the tolerance. The whole "whsec_…" string is the HMAC key.
 */
export async function verifyWebhook(rawBody: string, header: string | null, secret: string, nowMs = Date.now()): Promise<WebhookCheck> {
  if (!header) return { ok: false, reason: 'header' };
  let t: number | undefined;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && v && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  if (t === undefined || !v1.length) return { ok: false, reason: 'header' };
  if (Math.abs(nowMs / 1000 - t) > WEBHOOK_TOLERANCE_S) return { ok: false, reason: 'timestamp' };
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  let match = false;
  for (const sig of v1) if (await safeEqual(sig, expected)) match = true;
  if (!match) return { ok: false, reason: 'signature' };
  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    if (typeof event?.type !== 'string' || typeof event.data?.object !== 'object') return { ok: false, reason: 'payload' };
    return { ok: true, event };
  } catch {
    return { ok: false, reason: 'payload' };
  }
}

/** Builds a valid Stripe-Signature header (tests and local tooling). */
export async function signWebhook(rawBody: string, secret: string, nowMs = Date.now()): Promise<string> {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${rawBody}`)}`;
}

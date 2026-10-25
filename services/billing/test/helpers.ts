import { TEST_KEY_ID, TEST_PRIVATE_KEY } from '@doppelpunkt/license/testing';
import type { Config } from '../src/http';
import type { CheckoutSession } from '../src/stripe';

export const NOW = Date.parse('2026-10-25T12:00:00Z');
export const APP = 'https://app.example.org/doppelpunkt/';
export const ORIGIN = 'https://app.example.org';
export const PID = 'dp_0123456789abcdefghjk';

export const ENV: Config = {
  ALLOWED_ORIGINS: ORIGIN,
  APP_URL: APP,
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_PRICES: JSON.stringify({ 'level-a2': 'price_a2', 'pass-year': 'price_pass', 'book-1': 'price_nope' }),
  LICENSE_PRIVATE_KEY: TEST_PRIVATE_KEY,
  LICENSE_KEY_ID: TEST_KEY_ID,
  ALLOW_TEST_KEY: '1',
  HASH_SECRET: 'hash-secret',
};

export const session = (over: Partial<CheckoutSession> = {}): CheckoutSession => ({
  id: 'cs_test_a1b2c3d4e5f6',
  object: 'checkout.session',
  status: 'complete',
  payment_status: 'paid',
  client_reference_id: PID,
  metadata: { pid: PID, sku: 'level-a2' },
  customer_details: { email: 'Learner@Example.org' },
  payment_intent: 'pi_123',
  created: NOW / 1000 - 60,
  ...over,
});

export type Call = { url: string; method: string; headers: Headers; body: string };

/** A fetch stand-in for api.stripe.com that records calls and answers from `routes`. */
export function stripeMock(routes: Record<string, (call: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: String(init?.body ?? '') };
    calls.push(call);
    const path = new URL(call.url).pathname;
    const route = routes[`${call.method} ${path}`];
    if (!route) return new Response(JSON.stringify({ error: { message: `No such route ${path}` } }), { status: 404 });
    const r = route(call);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://billing.example.org${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

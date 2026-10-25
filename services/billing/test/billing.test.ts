import { beforeEach, describe, expect, it } from 'vitest';
import { generateCode, verifyToken, formatCode } from '@doppelpunkt/license';
import { TEST_KEY_ID, TEST_PUBLIC_KEY } from '@doppelpunkt/license/testing';
import { codeHash } from '../src/crypto';
import { handle, type Config, type Deps } from '../src/http';
import { MemoryRateLimiter } from '../src/ratelimit';
import { MemoryStorage } from '../src/storage-memory';
import { signWebhook, verifyWebhook, formEncode } from '../src/stripe';
import { APP, ENV, NOW, ORIGIN, PID, post, session, stripeMock } from './helpers';

const KEYS = { [TEST_KEY_ID]: TEST_PUBLIC_KEY };

let storage: MemoryStorage;
let deps: Deps;
let stripe: ReturnType<typeof stripeMock>;
let sessions: Record<string, ReturnType<typeof session>>;

beforeEach(() => {
  storage = new MemoryStorage();
  sessions = {};
  stripe = stripeMock({
    'POST /v1/checkout/sessions': () => ({ body: { id: 'cs_test_new123456', object: 'checkout.session', url: 'https://checkout.stripe.com/c/pay/cs_test_new123456' } }),
    'GET /v1/checkout/sessions/cs_test_a1b2c3d4e5f6': () => (sessions.cs_test_a1b2c3d4e5f6 ? { body: sessions.cs_test_a1b2c3d4e5f6 } : { status: 404, body: { error: { message: 'No such session' } } }),
  });
  deps = { storage, limiter: new MemoryRateLimiter(), fetch: stripe.fetchImpl, now: () => NOW };
});

const call = (req: Request, env: Config = ENV) => handle(req, env, deps);
const bodyOf = async (res: Response) => (await res.json()) as Record<string, any>;

async function webhook(event: unknown, opts: { secret?: string; at?: number; header?: string } = {}) {
  const raw = JSON.stringify(event);
  const header = opts.header ?? (await signWebhook(raw, opts.secret ?? ENV.STRIPE_WEBHOOK_SECRET!, opts.at ?? NOW));
  return call(new Request('https://billing.example.org/v1/webhook', { method: 'POST', headers: { 'stripe-signature': header }, body: raw }));
}

const completed = (s = session()) => ({ id: 'evt_1', type: 'checkout.session.completed', created: NOW / 1000, data: { object: s } });

describe('health and configuration', () => {
  it('reports what is configured', async () => {
    const res = await call(new Request('https://billing.example.org/v1/health', { headers: { origin: ORIGIN } }));
    expect(await bodyOf(res)).toEqual({ ok: true, service: 'doppelpunkt-billing', configured: { checkout: true, webhook: true, signing: true, hashing: true } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('refuses the public test key unless ALLOW_TEST_KEY=1', async () => {
    const res = await call(post('/v1/redeem', { code: generateCode('B1') }), { ...ENV, ALLOW_TEST_KEY: undefined });
    expect(res.status).toBe(503);
  });

  it('rejects other origins', async () => {
    const res = await call(post('/v1/checkout', { sku: 'level-a2' }, { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('rate-limits per client', async () => {
    const env = { ...ENV, RATE_LIMIT_PER_HOUR: '2' };
    const codes = [1, 2, 3].map(() => post('/v1/redeem', { code: 'B1' }, { 'cf-connecting-ip': '192.0.2.1' }));
    expect((await call(codes[0]!, env)).status).toBe(400);
    expect((await call(codes[1]!, env)).status).toBe(400);
    const third = await call(codes[2]!, env);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
    // Another client is not affected.
    expect((await call(post('/v1/redeem', { code: 'B1' }, { 'cf-connecting-ip': '192.0.2.2' }), env)).status).toBe(400);
  });
});

describe('POST /v1/checkout', () => {
  it('creates a Stripe Checkout Session with the configured price and a random purchase id', async () => {
    const res = await call(post('/v1/checkout', { sku: 'level-a2' }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.url).toBe('https://checkout.stripe.com/c/pay/cs_test_new123456');
    expect(body.pid).toMatch(/^dp_[0-9a-z]{20}$/);

    expect(stripe.calls).toHaveLength(1);
    const c = stripe.calls[0]!;
    expect(c.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(c.method).toBe('POST');
    expect(c.headers.get('authorization')).toBe('Bearer sk_test_123');
    expect(c.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(c.headers.get('idempotency-key')).toBe(`checkout-${body.pid}`);
    const form = new URLSearchParams(c.body);
    expect(form.get('mode')).toBe('payment');
    expect(form.get('line_items[0][price]')).toBe('price_a2');
    expect(form.get('line_items[0][quantity]')).toBe('1');
    expect(form.get('metadata[sku]')).toBe('level-a2');
    expect(form.get('metadata[pid]')).toBe(body.pid);
    expect(form.get('client_reference_id')).toBe(body.pid);
    expect(form.get('success_url')).toBe(`${APP}unlock/done?session_id={CHECKOUT_SESSION_ID}`);
    expect(form.get('cancel_url')).toBe(`${APP}unlock?cancelled=1`);
    expect(form.get('payment_intent_data[description]')).toContain(body.pid);
    // No personal data is sent to Stripe by us; Checkout collects the email itself.
    expect([...form.keys()].some((k) => /email|name|address/.test(k))).toBe(false);
  });

  it('refuses products that are not sold, and products without a price id', async () => {
    expect((await call(post('/v1/checkout', { sku: 'book-1' }))).status).toBe(400);
    expect((await call(post('/v1/checkout', { sku: 'nope' }))).status).toBe(400);
    const res = await call(post('/v1/checkout', { sku: 'level-b1' }));
    expect(res.status).toBe(503);
    expect((await bodyOf(res)).error.message).toMatch(/level-b1/);
    expect(stripe.calls).toHaveLength(0);
  });

  it('passes Stripe errors on as 502', async () => {
    stripe = stripeMock({ 'POST /v1/checkout/sessions': () => ({ status: 400, body: { error: { message: 'No such price' } } }) });
    deps.fetch = stripe.fetchImpl;
    const res = await call(post('/v1/checkout', { sku: 'pass-year' }));
    expect(res.status).toBe(502);
    expect((await bodyOf(res)).error.message).toBe('Stripe: No such price');
  });

  it('says so when Stripe is not configured', async () => {
    expect((await call(post('/v1/checkout', { sku: 'level-a2' }), { ...ENV, STRIPE_SECRET_KEY: undefined })).status).toBe(503);
  });
});

describe('POST /v1/webhook', () => {
  it('verifies the signature and issues a token for a paid session (idempotently)', async () => {
    const res = await webhook(completed());
    expect(res.status).toBe(200);
    const row = await storage.getPurchaseBySession('cs_test_a1b2c3d4e5f6');
    expect(row).toMatchObject({ pid: PID, sku: 'level-a2', source: 'checkout', paymentIntent: 'pi_123', status: 'paid' });
    // Only an HMAC of the email is stored.
    expect(row!.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/example\.org/i);
    const v = await verifyToken(row!.token, KEYS, NOW);
    expect(v).toEqual({ ok: true, payload: { v: 1, kid: 'test', pid: PID, sku: 'level-a2', lv: ['A2'], iat: NOW / 1000 - 60 } });

    // Stripe retries: same row, same token.
    await webhook(completed());
    expect(storage.purchases.size).toBe(1);
  });

  it('rejects a bad signature, a wrong secret, an old timestamp and a missing header', async () => {
    expect((await webhook(completed(), { secret: 'whsec_other' })).status).toBe(400);
    expect((await webhook(completed(), { at: NOW - 10 * 60_000 })).status).toBe(400);
    expect((await webhook(completed(), { header: 't=1,v1=deadbeef' })).status).toBe(400);
    const missing = await call(new Request('https://billing.example.org/v1/webhook', { method: 'POST', body: '{}' }));
    expect(missing.status).toBe(400);
    expect(storage.purchases.size).toBe(0);
  });

  it('rejects a body changed after signing', async () => {
    const raw = JSON.stringify(completed());
    const header = await signWebhook(raw, ENV.STRIPE_WEBHOOK_SECRET!, NOW);
    const tampered = raw.replace('level-a2', 'pass-year');
    expect((await verifyWebhook(tampered, header, ENV.STRIPE_WEBHOOK_SECRET!, NOW)).ok).toBe(false);
    expect((await verifyWebhook(raw, header, ENV.STRIPE_WEBHOOK_SECRET!, NOW)).ok).toBe(true);
    // Several v1 signatures (secret rotation): one match is enough.
    const [t, v1] = header.split(',');
    expect((await verifyWebhook(raw, `${t},v1=${'0'.repeat(64)},${v1}`, ENV.STRIPE_WEBHOOK_SECRET!, NOW)).ok).toBe(true);
  });

  it('ignores unpaid async sessions until async_payment_succeeded', async () => {
    await webhook(completed(session({ payment_status: 'unpaid' })));
    expect(storage.purchases.size).toBe(0);
    await webhook({ ...completed(), type: 'checkout.session.async_payment_succeeded' });
    expect(storage.purchases.size).toBe(1);
  });

  it('acknowledges sessions that are not ours without storing anything', async () => {
    const res = await webhook(completed(session({ metadata: {} })));
    expect(res.status).toBe(200);
    expect(storage.purchases.size).toBe(0);
  });

  it('marks refunded purchases, which can then not be claimed or restored', async () => {
    await webhook(completed());
    await webhook({ id: 'evt_2', type: 'charge.refunded', created: NOW / 1000, data: { object: { refunded: true, payment_intent: 'pi_123' } } });
    expect((await storage.getPurchase(PID))?.status).toBe('refunded');
    expect((await call(post('/v1/claim', { sessionId: 'cs_test_a1b2c3d4e5f6' }))).status).toBe(410);
    expect((await call(post('/v1/restore', { email: 'learner@example.org', reference: PID }))).status).toBe(410);
  });
});

describe('POST /v1/claim (after the Stripe redirect)', () => {
  it('returns the token the webhook stored, without calling Stripe', async () => {
    await webhook(completed());
    const res = await call(post('/v1/claim', { sessionId: 'cs_test_a1b2c3d4e5f6' }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toMatchObject({ pid: PID, sku: 'level-a2' });
    expect((await verifyToken(body.token, KEYS, NOW)).ok).toBe(true);
    expect(stripe.calls).toHaveLength(0);
  });

  it('asks Stripe when the webhook has not arrived yet', async () => {
    sessions.cs_test_a1b2c3d4e5f6 = session({ metadata: { pid: PID, sku: 'pass-year' } });
    const res = await call(post('/v1/claim', { sessionId: 'cs_test_a1b2c3d4e5f6' }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).sku).toBe('pass-year');
    expect(stripe.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /v1/checkout/sessions/cs_test_a1b2c3d4e5f6']);
    // The webhook arriving later changes nothing.
    await webhook(completed(sessions.cs_test_a1b2c3d4e5f6));
    expect(storage.purchases.size).toBe(1);
  });

  it('202 while unpaid, 404 for unknown sessions, 400 for junk', async () => {
    sessions.cs_test_a1b2c3d4e5f6 = session({ status: 'open', payment_status: 'unpaid' });
    expect((await call(post('/v1/claim', { sessionId: 'cs_test_a1b2c3d4e5f6' }))).status).toBe(202);
    expect((await call(post('/v1/claim', { sessionId: 'cs_test_unknown999' }))).status).toBe(404);
    expect((await call(post('/v1/claim', { sessionId: '../../v1/charges' }))).status).toBe(400);
    expect((await call(post('/v1/claim', 'not json'))).status).toBe(400);
  });
});

describe('POST /v1/redeem (book codes)', () => {
  async function addCode(code: string, over: { maxUses?: number; revoked?: boolean } = {}) {
    await storage.putCode({ hash: await codeHash(ENV.HASH_SECRET!, code), book: 'B1', maxUses: over.maxUses ?? 1, uses: 0, batch: 't', revoked: !!over.revoked, createdAt: NOW });
  }

  it('turns a valid code into an A2 token, typed in any format', async () => {
    const code = generateCode('B1');
    await addCode(code);
    const res = await call(post('/v1/redeem', { code: formatCode(code).toLowerCase() }));
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.sku).toBe('book-1');
    const v = await verifyToken(body.token, KEYS, NOW);
    expect(v.ok && v.payload.lv).toEqual(['A2']);
    expect(v.ok && v.payload.exp).toBeUndefined();
    // The code itself is not stored, only its HMAC.
    expect(JSON.stringify([...storage.codes.values(), ...storage.purchases.values()])).not.toContain(code);
  });

  it('single-use codes work once; limited codes as often as allowed', async () => {
    const once = generateCode('B1');
    const twice = generateCode('B1');
    await addCode(once);
    await addCode(twice, { maxUses: 2 });
    expect((await call(post('/v1/redeem', { code: once }))).status).toBe(200);
    const again = await call(post('/v1/redeem', { code: once }));
    expect(again.status).toBe(409);
    expect((await call(post('/v1/redeem', { code: twice }))).status).toBe(200);
    expect((await call(post('/v1/redeem', { code: twice }))).status).toBe(200);
    expect((await call(post('/v1/redeem', { code: twice }))).status).toBe(409);
  });

  it('rejects typos before looking anything up, and unknown or revoked codes', async () => {
    const code = generateCode('B1');
    await addCode(code, { revoked: true });
    const typo = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
    const t = await call(post('/v1/redeem', { code: typo }));
    expect(t.status).toBe(400);
    expect((await bodyOf(t)).error.message).toMatch(/typo/);
    expect((await call(post('/v1/redeem', { code }))).status).toBe(404);
    expect((await call(post('/v1/redeem', { code: generateCode('B1') }))).status).toBe(404);
    expect((await call(post('/v1/redeem', { code: 42 }))).status).toBe(400);
  });
});

describe('POST /v1/restore', () => {
  beforeEach(async () => {
    await webhook(completed());
  });

  it('by purchase id + email (case and spaces ignored)', async () => {
    const res = await call(post('/v1/restore', { email: '  LEARNER@example.org ', reference: PID.toUpperCase().replace('DP_', 'dp_') }));
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).pid).toBe(PID);
  });

  it('by checkout session id + email', async () => {
    const res = await call(post('/v1/restore', { email: 'learner@example.org', reference: 'cs_test_a1b2c3d4e5f6' }));
    expect(res.status).toBe(200);
  });

  it('the same 404 for a wrong email and an unknown reference', async () => {
    const wrong = await call(post('/v1/restore', { email: 'someone@example.org', reference: PID }));
    const unknown = await call(post('/v1/restore', { email: 'learner@example.org', reference: 'dp_zzzzzzzzzzzzzzzzzzzz' }));
    expect(wrong.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await bodyOf(wrong)).toEqual(await bodyOf(unknown));
  });

  it('finds a paid session the webhook missed', async () => {
    storage.purchases.clear();
    sessions.cs_test_a1b2c3d4e5f6 = session();
    const res = await call(post('/v1/restore', { email: 'learner@example.org', reference: 'cs_test_a1b2c3d4e5f6' }));
    expect(res.status).toBe(200);
  });

  it('validates input', async () => {
    expect((await call(post('/v1/restore', { email: 'nope', reference: PID }))).status).toBe(400);
    expect((await call(post('/v1/restore', { email: 'learner@example.org', reference: 'x' }))).status).toBe(400);
  });
});

describe('formEncode', () => {
  it('flattens nested params the way Stripe expects', () => {
    expect(decodeURIComponent(formEncode({ a: 1, b: { c: 'x', d: [{ e: 2 }] }, skip: undefined }))).toBe('a=1&b[c]=x&b[d][0][e]=2');
  });
});

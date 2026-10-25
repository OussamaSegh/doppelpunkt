// In-process mock of services/billing for the payments build (dist-billing, VITE_BILLING_URL =
// BILLING_ORIGIN, where nothing listens). page.route answers instead and signs real tokens with the
// public TEST key (packages/license/src/testing.ts), which the e2e build trusts. The Worker itself is
// tested in services/billing/test.
import type { BrowserContext, Route } from '@playwright/test';
import { checkCode, importPrivateKey, payloadFor, signToken, type Sku } from '@doppelpunkt/license';
import { TEST_KEY_ID, TEST_PRIVATE_KEY } from '@doppelpunkt/license/testing';
import { expect, test as base } from '../fixtures';

/** Keep in sync with E2E_BILLING_URL in vite.config.ts. */
export const BILLING_ORIGIN = 'http://127.0.0.1:4339';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export type BillingCall = { path: string; body: Record<string, unknown> };

let n = 0;
export const newPid = () => `dp_e2e${String(++n).padStart(17, '0')}`;

export async function testToken(sku: Sku, pid = newPid(), now = Date.now()): Promise<string> {
  return signToken(payloadFor(sku, { kid: TEST_KEY_ID, pid, now }), await importPrivateKey(TEST_PRIVATE_KEY));
}

export class MockBilling {
  readonly calls: BillingCall[] = [];
  /** Valid book codes (normalised) and how many uses each has left. */
  readonly codes = new Map<string, number>();
  /** Purchases for restore: pid -> { email, sku }. */
  readonly purchases = new Map<string, { email: string; sku: Sku }>();
  /** Answer the first claim with 202 (payment still processing). */
  pendingClaims = 0;

  async install(context: BrowserContext) {
    await context.route(`${BILLING_ORIGIN}/**`, (route) => this.handle(route));
  }

  private async handle(route: Route) {
    const req = route.request();
    const reply = (status: number, json: unknown) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(json) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    this.calls.push({ path, body });
    switch (path) {
      case '/v1/checkout': {
        const sku = String(body.sku);
        const origin = req.headers()['origin'] ?? '';
        const sessionId = `cs_test_e2e_${sku.replace(/-/g, '_')}`;
        return reply(200, { url: `${origin}/unlock/done?session_id=${sessionId}`, sessionId, pid: newPid() });
      }
      case '/v1/claim': {
        if (this.pendingClaims > 0) {
          this.pendingClaims--;
          return reply(202, { pending: true });
        }
        const sku = String(body.sessionId).replace('cs_test_e2e_', '').replace(/_/g, '-') as Sku;
        const pid = newPid();
        return reply(200, { token: await testToken(sku, pid), pid, sku });
      }
      case '/v1/redeem': {
        const check = checkCode(String(body.code));
        if (!check.ok) return reply(400, { error: { message: 'This code has a typo. Check it and try again.' } });
        const left = this.codes.get(check.code);
        if (left === undefined) return reply(404, { error: { message: 'We could not find this code.' } });
        if (left <= 0) return reply(409, { error: { message: 'This code has already been used as often as it allows.' } });
        this.codes.set(check.code, left - 1);
        const pid = newPid();
        return reply(200, { token: await testToken(check.sku, pid), pid, sku: check.sku });
      }
      case '/v1/restore': {
        const p = this.purchases.get(String(body.reference));
        if (!p || p.email !== String(body.email).toLowerCase()) return reply(404, { error: { message: 'No purchase matches this email address and reference.' } });
        return reply(200, { token: await testToken(p.sku, String(body.reference)), pid: body.reference, sku: p.sku });
      }
    }
    return reply(404, { error: { message: 'Not found' } });
  }
}

export const test = base.extend<{ billing: MockBilling }>({
  billing: [
    async ({ context }, use) => {
      const b = new MockBilling();
      await b.install(context);
      await use(b);
    },
    { auto: true },
  ],
});

export { expect };

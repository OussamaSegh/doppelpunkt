// Calls to the billing Worker (services/billing). Loaded only by the Unlock screen. Every answer that
// carries a token is verified and stored on the device by addLicense.
import type { Sku } from '@doppelpunkt/license';
import type { LicenseRow } from '../../db';
import { addLicense, VERIFY_MESSAGES, type AddResult } from './entitlements';
import { billingUrl } from './config';

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, fetchImpl: typeof fetch = fetch): Promise<{ status: number; data: T }> {
  const base = billingUrl();
  if (!base) throw new BillingError('Payments are not set up in this version of the app.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new BillingError("You're offline. Connect to the internet and try again.");
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new BillingError('Could not reach the payment server. Check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok && res.status !== 202) {
    const msg = data.error?.message ?? `The payment server answered with HTTP ${res.status}.`;
    throw new BillingError(res.status === 429 ? 'Too many attempts. Please wait a while and try again.' : msg, res.status);
  }
  return { status: res.status, data };
}

type TokenAnswer = { token: string; pid: string; sku: string };

async function store(token: string, source: LicenseRow['source']): Promise<Extract<AddResult, { ok: true }>> {
  const r = await addLicense(token, source);
  if (!r.ok) throw new BillingError(VERIFY_MESSAGES[r.reason]);
  return r;
}

/** Creates a Stripe Checkout session and returns the URL to send the learner to. */
export async function startCheckout(sku: Sku, fetchImpl?: typeof fetch): Promise<string> {
  const { data } = await post<{ url: string }>('/v1/checkout', { sku }, fetchImpl);
  // Stripe Checkout is https; plain http only for a local test server.
  if (!data.url || !/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(data.url)) throw new BillingError('The payment server sent no checkout link.');
  return data.url;
}

/** After the Stripe redirect: fetches and stores the token. `pending` while the payment is still processing. */
export async function claimCheckout(sessionId: string, fetchImpl?: typeof fetch) {
  const { status, data } = await post<TokenAnswer & { pending?: boolean }>('/v1/claim', { sessionId }, fetchImpl);
  if (status === 202 || data.pending) return { pending: true as const };
  return { pending: false as const, ...(await store(data.token, 'checkout')) };
}

export async function redeemCode(code: string, fetchImpl?: typeof fetch) {
  const { data } = await post<TokenAnswer>('/v1/redeem', { code }, fetchImpl);
  return store(data.token, 'code');
}

export async function restorePurchase(email: string, reference: string, fetchImpl?: typeof fetch) {
  const { data } = await post<TokenAnswer>('/v1/restore', { email: email.trim(), reference: reference.trim() }, fetchImpl);
  return store(data.token, 'restore');
}

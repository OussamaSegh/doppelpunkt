/**
 * Billing logic, independent of HTTP: fulfil a paid Checkout Session into a signed license token
 * (idempotent: the webhook, the success-page claim and "restore" may all race), redeem book codes
 * and look purchases up for "restore".
 */
import { checkCode, importPrivateKey, payloadFor, productFor, signToken, newPurchaseId, type Sku } from '@doppelpunkt/license';
import { codeHash, emailHash, safeEqual } from './crypto';
import type { PurchaseRow, Storage } from './storage';
import type { CheckoutSession } from './stripe';

export type Signer = { kid: string; key: Promise<CryptoKey> };

const signers = new Map<string, Signer>();

/** Caches the imported private key per isolate. */
export function signer(kid: string, pkcs8: string): Signer {
  const id = `${kid}|${pkcs8}`;
  let s = signers.get(id);
  if (!s) {
    s = { kid, key: importPrivateKey(pkcs8) };
    s.key.catch(() => signers.delete(id));
    signers.set(id, s);
  }
  return s;
}

async function issue(sku: Sku, pid: string, s: Signer, nowMs: number): Promise<string> {
  return signToken(payloadFor(sku, { kid: s.kid, pid, now: nowMs }), await s.key);
}

const paymentIntentId = (s: CheckoutSession) => (typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? undefined));

export const isPaid = (s: CheckoutSession) => s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required');

export class FulfilError extends Error {}

/**
 * Turns a paid session into a purchase row with a token. Calling it again for the same session
 * returns the stored row. The token's issue time is the session's creation time, so a yearly pass
 * runs from the purchase and re-signing gives the same token (Ed25519 is deterministic).
 */
export async function fulfil(storage: Storage, session: CheckoutSession, opts: { signer: Signer; hashSecret: string }): Promise<PurchaseRow> {
  const existing = await storage.getPurchaseBySession(session.id);
  if (existing) return existing;
  if (!isPaid(session)) throw new FulfilError('session is not paid');
  const sku = session.metadata?.sku;
  const pid = session.metadata?.pid ?? session.client_reference_id ?? undefined;
  const product = sku ? productFor(sku) : undefined;
  if (!product || !product.price || !pid || !/^dp_[0-9a-z]{20}$/.test(pid)) throw new FulfilError('session has no Doppelpunkt product');
  const email = session.customer_details?.email ?? session.customer_email ?? undefined;
  const createdMs = session.created * 1000;
  const row: PurchaseRow = {
    pid,
    source: 'checkout',
    sku: product.sku,
    sessionId: session.id,
    paymentIntent: paymentIntentId(session),
    emailHash: email ? await emailHash(opts.hashSecret, email) : undefined,
    token: await issue(product.sku, pid, opts.signer, createdMs),
    status: 'paid',
    createdAt: Date.now(),
  };
  return storage.insertPurchase(row);
}

export type RedeemResult =
  | { ok: true; token: string; pid: string }
  | { ok: false; status: 400 | 404 | 409; message: string };

/** Redeems a book access code into a new token (one use per call). */
export async function redeem(storage: Storage, input: unknown, opts: { signer: Signer; hashSecret: string; now: number }): Promise<RedeemResult> {
  if (typeof input !== 'string' || input.length > 64) return { ok: false, status: 400, message: 'Send { "code": "..." }' };
  const check = checkCode(input);
  if (!check.ok) return { ok: false, status: 400, message: check.reason === 'checksum' ? 'This code has a typo. Check it and try again.' : 'This is not a Doppelpunkt book code.' };
  const hash = await codeHash(opts.hashSecret, check.code);
  const row = await storage.getCode(hash);
  if (!row || row.revoked || row.book !== check.book) return { ok: false, status: 404, message: 'We could not find this code.' };
  if (!(await storage.takeCodeUse(hash))) return { ok: false, status: 409, message: 'This code has already been used as often as it allows.' };
  try {
    const pid = newPurchaseId();
    const token = await issue(check.sku, pid, opts.signer, opts.now);
    await storage.insertPurchase({ pid, source: 'code', sku: check.sku, codeHash: hash, token, status: 'paid', createdAt: opts.now });
    return { ok: true, token, pid };
  } catch (e) {
    await storage.releaseCodeUse(hash);
    throw e;
  }
}

/** Finds the purchase for "restore": by purchase id or Checkout Session id, guarded by the email. */
export async function findForRestore(
  storage: Storage,
  email: string,
  reference: string,
  opts: { hashSecret: string; retrieve: (sessionId: string) => Promise<CheckoutSession | null>; signer: Signer },
): Promise<PurchaseRow | null> {
  const ref = reference.trim();
  let row = /^dp_/i.test(ref) ? await storage.getPurchase(ref.toLowerCase()) : /^cs_/.test(ref) ? await storage.getPurchaseBySession(ref) : null;
  if (!row && /^cs_/.test(ref)) {
    // The webhook may not have arrived (or was not configured): ask Stripe.
    const session = await opts.retrieve(ref);
    if (session && isPaid(session)) row = await fulfil(storage, session, opts).catch(() => null);
  }
  if (!row || row.source !== 'checkout' || !row.emailHash) return null;
  return (await safeEqual(row.emailHash, await emailHash(opts.hashSecret, email))) ? row : null;
}

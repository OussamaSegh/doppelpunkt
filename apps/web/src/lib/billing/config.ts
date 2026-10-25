// Payments configuration, baked in at build time. Without VITE_BILLING_URL and
// VITE_LICENSE_PUBLIC_KEYS payments are off and every level is unlocked (development, self-hosting,
// the public GitHub Pages demo). See docs/PAYMENTS.md.
import { parsePublicKeys } from '@doppelpunkt/license';

// `import.meta.env` is undefined when Node imports this module directly (Playwright specs).
const env = (): Partial<ImportMetaEnv> => import.meta.env ?? {};

/** Billing Worker base URL without a trailing slash, or undefined. https only (http for localhost). */
export function billingUrl(): string | undefined {
  const raw = String(env().VITE_BILLING_URL ?? '').trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return undefined;
    return raw.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Public keys the device trusts for license tokens, by key id. Read on every call so tests can stub it. */
export function publicKeys(): Record<string, string> {
  return parsePublicKeys(String(env().VITE_LICENSE_PUBLIC_KEYS ?? ''));
}

/** true when this build sells levels: A2+ need an unlock. */
export function billingActive(): boolean {
  return !!billingUrl() && Object.keys(publicKeys()).length > 0;
}

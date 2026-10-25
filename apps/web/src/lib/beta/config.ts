// Beta programme configuration. The collector URL is baked in at build time; without it the beta
// features explain that they are not active and nothing is ever sent.

// `import.meta.env` is undefined when Node imports this module directly (Playwright specs import lib modules).
const env = (): Partial<ImportMetaEnv> => import.meta.env ?? {};

/** App version reported in beta envelopes (root package.json, set by vite.config.ts). */
export const APP_VERSION: string = String(env().VITE_APP_VERSION || '0.0.0-dev').slice(0, 32);

/**
 * Collector base URL without a trailing slash, or undefined when this build has none.
 * Must be https (http only for localhost, for local testing). Read on every call so tests can stub it.
 */
export function collectorUrl(): string | undefined {
  const raw = String(env().VITE_COLLECTOR_URL ?? '').trim();
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

export const betaActive = (): boolean => !!collectorUrl();

export const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Install ids are rotated after this many days. */
export const INSTALL_ID_MAX_AGE_DAYS = 90;

/** At most this many crash reports wait in the outbox; more are dropped. */
export const MAX_QUEUED_CRASHES = 20;

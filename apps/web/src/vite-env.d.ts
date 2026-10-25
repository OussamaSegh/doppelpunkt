/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Beta collector base URL (services/collector). Unset: the beta programme is off and nothing is sent. */
  readonly VITE_COLLECTOR_URL?: string;
  /** Billing Worker base URL (services/billing). Unset: payments are off and every level is unlocked. */
  readonly VITE_BILLING_URL?: string;
  /** Public keys for license tokens, "kid:base64url[,kid2:…]" (npm run keygen -w @doppelpunkt/license). */
  readonly VITE_LICENSE_PUBLIC_KEYS?: string;
  /** Set by vite.config.ts from the root package.json. */
  readonly VITE_APP_VERSION?: string;
}

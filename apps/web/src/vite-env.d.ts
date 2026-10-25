/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Beta collector base URL (services/collector). Unset: the beta programme is off and nothing is sent. */
  readonly VITE_COLLECTOR_URL?: string;
  /** Set by vite.config.ts from the root package.json. */
  readonly VITE_APP_VERSION?: string;
}

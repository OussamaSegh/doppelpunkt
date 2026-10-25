/**
 * TEST-ONLY Ed25519 keypair for unit tests, the e2e billing build and `wrangler dev`.
 * The private key is public (it is in git), so anything signed with it is worthless.
 * NEVER use it in production: apps/web/vite.config.ts refuses to bake TEST_KEY_ID into a
 * production build, and the billing Worker refuses to sign with it unless ALLOW_TEST_KEY=1.
 * Generate the real pair with `npm run keygen -w @doppelpunkt/license` (docs/PAYMENTS.md).
 */
export const TEST_KEY_ID = 'test';
export const TEST_PUBLIC_KEY = 'GuiNp1C5G_QgabPYBnp4c8UFd8gOz-3UPex1-Ap1GWw';
export const TEST_PRIVATE_KEY = 'MC4CAQAwBQYDK2VwBCIEICnLjwa8Tn-uvex38cnw--oFXNDuKWDY3S_oNozMasBX';
/** VITE_LICENSE_PUBLIC_KEYS value for test builds. */
export const TEST_PUBLIC_KEYS_SPEC = `${TEST_KEY_ID}:${TEST_PUBLIC_KEY}`;

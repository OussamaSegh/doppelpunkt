// @vitest-environment node
// The build refuses the public TEST key (vite.config.ts checkBillingEnv), under any key id and
// whether it comes from process.env or a .env file of the mode.
import { describe, expect, it, vi } from 'vitest';
import { TEST_PUBLIC_KEY } from '@doppelpunkt/license/testing';
import { checkBillingEnv } from '../../../vite.config';

const URL_ = 'https://billing.example.org';

describe('build guard for the license public keys', () => {
  it('refuses the TEST key in a production build, under any key id', () => {
    expect(() => checkBillingEnv('production', { VITE_BILLING_URL: URL_, VITE_LICENSE_PUBLIC_KEYS: `test:${TEST_PUBLIC_KEY}` })).toThrow(/TEST key/);
    expect(() => checkBillingEnv('production', { VITE_BILLING_URL: URL_, VITE_LICENSE_PUBLIC_KEYS: `prod:${TEST_PUBLIC_KEY}` })).toThrow(/TEST key/);
    expect(() => checkBillingEnv('production', { VITE_LICENSE_PUBLIC_KEYS: `k1:${'A'.repeat(43)}, k2:${TEST_PUBLIC_KEY}` })).toThrow(/TEST key/);
  });

  it('allows it in the e2e-billing build and accepts real keys', () => {
    expect(() => checkBillingEnv('e2e-billing', { VITE_BILLING_URL: URL_, VITE_LICENSE_PUBLIC_KEYS: `test:${TEST_PUBLIC_KEY}` })).not.toThrow();
    expect(() => checkBillingEnv('production', { VITE_BILLING_URL: URL_, VITE_LICENSE_PUBLIC_KEYS: `k2026:${'A'.repeat(43)}` })).not.toThrow();
  });

  it('warns when only one of the two variables is set (payments stay off)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    checkBillingEnv('production', { VITE_BILLING_URL: URL_ });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('the config checks the .env files of the mode, not only process.env', async () => {
    const { default: config } = await import('../../../vite.config');
    const { writeFileSync, rmSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    // A throwaway mode, so no real .env file is touched; apps/web is Vite's envDir.
    const file = fileURLToPath(new URL('../../../.env.qa-guard-test', import.meta.url));
    writeFileSync(file, `VITE_BILLING_URL=${URL_}\nVITE_LICENSE_PUBLIC_KEYS=prod:${TEST_PUBLIC_KEY}\n`);
    try {
      const run = config as unknown as (env: { mode: string; command: 'build' }) => unknown;
      expect(() => run({ mode: 'qa-guard-test', command: 'build' })).toThrow(/TEST key/);
    } finally {
      rmSync(file, { force: true });
    }
  });
});

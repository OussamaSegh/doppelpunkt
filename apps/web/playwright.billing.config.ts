import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Payments variant of the app: the production build with VITE_BILLING_URL pointing at a mock billing
// Worker and the public TEST key trusted (`npm run build:e2e-billing` → dist-billing), served by
// `vite preview` on its own port. The specs in e2e/billing answer the billing API with page.route
// (e2e/billing/billing.ts). Run after the main and beta suites by `npm run test:e2e`, or alone with
// `npm run test:e2e:billing`.
const PORT = 4321;
const BASE_URL = `http://localhost:${PORT}`;
const CI = !!process.env.CI;

const webDir = fileURLToPath(new URL('.', import.meta.url));
// e2e/fixtures.ts reads the packs of the build under test.
process.env.E2E_DIST = 'dist-billing';
const preview = `npx vite preview --outDir dist-billing --port ${PORT} --strictPort`;
const needsBuild = !CI && (process.env.E2E_BUILD === '1' || !existsSync(`${webDir}dist-billing/index.html`) || !existsSync(`${webDir}dist-billing/packs/index.json`));
const command = needsBuild ? `npm --prefix ../.. run content:build && npm run build:e2e-billing && ${preview}` : preview;

export default defineConfig({
  testDir: './e2e/billing',
  outputDir: './test-results-billing',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-billing' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-billing' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    // page.route must see every billing request; with a service worker in control it may not.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'billing-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command,
    cwd: webDir,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Beta variant of the app: the same production build with VITE_COLLECTOR_URL pointing at a mock
// collector (`npm run build:e2e-beta` → dist-beta), served by `vite preview` on its own port.
// The specs in e2e/beta answer the collector with page.route and validate every envelope with
// BetaEnvelope from @doppelpunkt/beta-schema (e2e/beta/collector.ts). Run after the main suite by
// `npm run test:e2e`, or alone with `npm run test:e2e:beta`.
const PORT = 4320;
const BASE_URL = `http://localhost:${PORT}`;
const CI = !!process.env.CI;

const webDir = fileURLToPath(new URL('.', import.meta.url));
// e2e/fixtures.ts reads the packs of the build under test.
process.env.E2E_DIST = 'dist-beta';
const preview = `npx vite preview --outDir dist-beta --port ${PORT} --strictPort`;
// CI builds in its own step. Locally, build when there is no dist-beta yet or E2E_BUILD=1 asks for it.
// content:build compiles the packs into public/packs, which the build copies.
const needsBuild = !CI && (process.env.E2E_BUILD === '1' || !existsSync(`${webDir}dist-beta/index.html`) || !existsSync(`${webDir}dist-beta/packs/index.json`));
const command = needsBuild ? `npm --prefix ../.. run content:build && npm run build:e2e-beta && ${preview}` : preview;

export default defineConfig({
  testDir: './e2e/beta',
  outputDir: './test-results-beta',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-beta' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-beta' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
    // page.route must see every collector request; with a service worker in control it may not.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'beta-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command,
    cwd: webDir,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});

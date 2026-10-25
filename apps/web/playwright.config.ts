import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs against the production build (`npm run build` at the repo root, which also
// compiles the content packs) served by `vite preview` on a fixed port.
const PORT = 4319;
const BASE_URL = `http://localhost:${PORT}`;
const CI = !!process.env.CI;

const webDir = fileURLToPath(new URL('.', import.meta.url));
const preview = `npx vite preview --port ${PORT} --strictPort`;
// CI builds in its own step. Locally, build when there is no dist yet or E2E_BUILD=1 asks for it.
const needsBuild = !CI && (process.env.E2E_BUILD === '1' || !existsSync(`${webDir}dist/index.html`) || !existsSync(`${webDir}dist/packs/index.json`));
const command = needsBuild ? `npm --prefix ../.. run build && ${preview}` : preview;

export default defineConfig({
  testDir: './e2e',
  // The beta-build specs run against dist-beta (VITE_COLLECTOR_URL set): playwright.beta.config.ts;
  // the payments specs against dist-billing: playwright.billing.config.ts.
  testIgnore: ['beta/**', 'billing/**'],
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command,
    cwd: webDir,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});

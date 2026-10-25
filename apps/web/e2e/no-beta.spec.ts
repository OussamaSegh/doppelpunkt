// v0.5: the regular build has no VITE_COLLECTOR_URL. It shows no beta UI and talks to nobody but
// its own origin. (The beta build is tested by playwright.beta.config.ts, e2e/beta/.)
import type { Page } from '@playwright/test';
import { answerCorrectly, expect, firstOfType, navTo, onboard, openItem, result, test, uebungen, unit1 } from './fixtures';

/** Every request the page makes to another origin. */
function foreignRequests(page: Page, baseURL: string): string[] {
  const out: string[] = [];
  const own = new URL(baseURL).origin;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http') && u.origin !== own) out.push(`${r.method()} ${r.url()}`);
  });
  return out;
}

test('no collector: no beta card, no "Report a problem", no beta links, and no request leaves the app origin', async ({ page, baseURL }) => {
  const foreign = foreignRequests(page, baseURL!);
  await onboard(page);
  await expect(page.getByRole('region', { name: 'Help improve Doppelpunkt (beta)' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Beta feedback/ })).toHaveCount(0);

  const unit = unit1();
  const { ex } = firstOfType(uebungen(unit), 'mcq');
  await openItem(page, unit, ex);
  await answerCorrectly(page, ex);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Report a problem' })).toHaveCount(0);

  await navTo(page, 'Settings');
  await expect(page.getByText('The beta programme is not active in this build. Nothing is ever sent from this app')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Share anonymous item statistics|Send crash reports/ })).toHaveCount(0);

  await page.goto('/beta');
  await expect(page.getByRole('heading', { level: 1, name: 'Doppelpunkt beta' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'The beta programme is not active in this build, so nothing is ever sent.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Waiting to be sent' })).toHaveCount(0);

  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'The beta programme is not active in this build: this app sends nothing to us.' })).toBeVisible();

  // Past the beta start-up sync (3 s) on this page.
  await page.waitForTimeout(3_500);
  expect(foreign).toEqual([]);
});

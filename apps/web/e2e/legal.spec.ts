// v1.0: the public pages (about, privacy, terms, imprint), the static landing page, and the default
// build without billing: every level stays unlocked.
import { expect, navTo, onboard, test } from './fixtures';

test('legal and about pages open before onboarding and link to each other', async ({ page }) => {
  await page.goto('/welcome');
  const nav = page.getByRole('navigation', { name: 'About and legal' });
  await nav.getByRole('link', { name: 'What is Doppelpunkt?' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Doppelpunkt' })).toBeVisible();
  await expect(page.getByText('Standard German', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Grüezi! Wie gaats Ine?')).toBeVisible();

  for (const [link, heading, text] of [
    ['Privacy policy', 'Privacy', 'Stripe'],
    ['Terms of use', 'Terms of use', 'Right of withdrawal'],
    ['Imprint', 'Imprint', '[OPERATOR NAME]'],
  ] as const) {
    await page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: link }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole('article')).toContainText(text);
    // Placeholders for the operator are flagged, never filled with invented data.
    await expect(page.getByRole('note').filter({ hasText: 'placeholders' })).toBeVisible();
  }
  // Still not onboarded: other routes go to /welcome.
  await page.goto('/learn');
  await expect(page).toHaveURL(/\/welcome$/);
});

test('Settings links to the legal pages; without billing every level is unlocked', async ({ page }) => {
  await onboard(page);
  await navTo(page, 'Settings');
  await expect(page.getByRole('region', { name: 'Unlocks' })).toContainText('every level is unlocked');
  const legal = page.getByRole('navigation', { name: 'About and legal' });
  await expect(legal.getByRole('link', { name: 'Terms of use' })).toHaveAttribute('href', '/terms');
  await expect(legal.getByRole('link', { name: 'Imprint' })).toHaveAttribute('href', '/imprint');

  await page.goto('/learn/A2');
  await expect(page.getByRole('list', { name: 'A2 units' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'A2 is locked' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'A2 units' }).getByText('Locked', { exact: true })).toHaveCount(0);
  await page.goto('/unlock');
  await expect(page.getByRole('status')).toContainText('every level is already unlocked');
});

test('the static landing page: both varieties, themes, and "Open the app"', async ({ page }) => {
  await page.goto('/landing/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Standard German');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Swiss German');
  await expect(page.getByText('Vo wo chunnsch du?')).toBeVisible();
  await expect(page.getByText('Woher kommst du?')).toBeVisible();

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const first = await theme();
  await page.getByRole('button', { name: /light and dark theme/ }).click();
  expect(await theme()).not.toBe(first);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe((await theme()) === 'dark' ? 'rgb(15, 22, 38)' : 'rgb(251, 248, 241)');

  for (const name of ['Privacy policy', 'Terms of use', 'Imprint']) await expect(page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name })).toBeVisible();
  await page.getByRole('link', { name: 'Open the app' }).first().click();
  await expect(page).toHaveURL(/\/welcome$/);
});

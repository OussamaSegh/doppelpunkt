// Payments build (VITE_BILLING_URL + the TEST public key): A1 free, A2 locked except unit 1, unlock
// by book code, Stripe checkout (mocked) and restore; tokens are verified on the device.
import type { Page } from '@playwright/test';
import { formatCode, generateCode } from '@doppelpunkt/license';
import { allPacks, navTo, onboard } from '../fixtures';
import { BILLING_ORIGIN, expect, testToken, test } from './billing';

const a2 = () => {
  const p = allPacks().find((x) => x.level === 'A2');
  if (!p || p.units.length < 2) throw new Error('the e2e build needs at least two A2 units');
  return p;
};
const unitN = (num: number) => a2().units.find((u) => u.number === num)!;

async function expectA2Locked(page: Page) {
  await page.goto('/learn/A2');
  await expect(page.getByRole('note', { name: 'A2 is locked' })).toBeVisible();
  const cards = page.getByRole('list', { name: 'A2 units' }).getByRole('listitem');
  await expect(cards.nth(0)).toContainText('Free preview');
  await expect(cards.nth(1)).toContainText('Locked');
}

async function expectA2Open(page: Page) {
  await page.goto('/learn/A2');
  const cards = page.getByRole('list', { name: 'A2 units' }).getByRole('listitem');
  await expect(cards.first()).toBeVisible();
  await expect(page.getByRole('note', { name: 'A2 is locked' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'A2 units' }).getByText('Locked', { exact: true })).toHaveCount(0);
  await page.goto(`/unit/${unitN(2).id}`);
  await expect(page.getByRole('heading', { level: 1, name: unitN(2).title })).toBeVisible();
}

test('A1 is free, A2 unit 1 is a free preview, the rest of A2 is locked', async ({ page, billing }) => {
  await onboard(page);
  // A1 has no locks.
  await expect(page.getByRole('list', { name: 'A1 units' }).getByText('Locked', { exact: true })).toHaveCount(0);
  const levels = page.getByRole('navigation', { name: 'Levels' });
  await expect(levels.getByRole('link', { name: /^A2.*locked/ })).toBeVisible();

  await expectA2Locked(page);
  // The preview unit opens.
  await page.goto(`/unit/${unitN(1).id}`);
  await expect(page.getByRole('heading', { level: 1, name: unitN(1).title })).toBeVisible();
  // Unit 2 shows the lock screen, also on a deep link to a step.
  await page.goto(`/unit/${unitN(2).id}/uebungen`);
  await expect(page.getByRole('heading', { level: 1, name: 'Unit 2 is part of A2' })).toBeVisible();
  await page.getByRole('link', { name: 'Unlock A2' }).click();
  await expect(page).toHaveURL(/\/unlock\/A2$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Unlock levels' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buy A2 level' })).toContainText('14.90');
  await expect(page.getByRole('button', { name: 'Buy All levels for a year' })).toContainText('39.00');
  expect(billing.calls).toEqual([]);
});

test('a book code unlocks A2; typos are caught on the device; the unlock survives a reload without the server', async ({ page, billing }) => {
  const code = generateCode('B1');
  billing.codes.set(code, 1);
  await onboard(page);
  await page.goto('/unlock');
  const input = page.getByRole('textbox', { name: 'Book access code' });
  const typo = code.slice(0, 3) + (code[3] === 'A' ? 'B' : 'A') + code.slice(4);
  await input.fill(typo);
  await page.getByRole('button', { name: 'Redeem code' }).click();
  await expect(page.getByRole('alert')).toContainText('typo');
  expect(billing.calls).toEqual([]);

  await input.fill(formatCode(code).toLowerCase());
  await page.getByRole('button', { name: 'Redeem code' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'A2 unlocked' })).toContainText('Book 1');
  expect(billing.calls).toEqual([{ path: '/v1/redeem', body: { code } }]);

  // Used up: a second redeem is refused by the server.
  await input.fill(code);
  await page.getByRole('button', { name: 'Redeem code' }).click();
  await expect(page.getByRole('alert')).toContainText('already been used');

  // Verified on the device: no request to the billing server after a reload.
  const before = billing.calls.length;
  await page.reload();
  await expectA2Open(page);
  expect(billing.calls.length).toBe(before);
});

test('Stripe checkout: redirect, return to /unlock/done, claim the token', async ({ page, billing }) => {
  billing.pendingClaims = 1;
  await onboard(page);
  await expectA2Locked(page);
  await page.goto('/unlock/A2');
  await page.getByRole('button', { name: 'Buy A2 level' }).click();
  await expect(page).toHaveURL(/\/unlock\/done\?session_id=cs_test_e2e_level_a2$/);
  // First answer: still processing; the page polls again.
  await expect(page.getByRole('status').filter({ hasText: 'A2 unlocked' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Your purchase id: dp_e2e/)).toBeVisible();
  expect(billing.calls.map((c) => c.path)).toEqual(['/v1/checkout', '/v1/claim', '/v1/claim']);
  expect(billing.calls[0]!.body).toEqual({ sku: 'level-a2' });

  await expectA2Open(page);
  await navTo(page, 'Settings');
  const unlocks = page.getByRole('list', { name: 'Unlock tokens on this device' });
  await expect(unlocks.getByRole('group', { name: 'A2 level' })).toContainText('Unlocks A2');
  await expect(unlocks.getByRole('group', { name: 'A2 level' })).toContainText('no expiry');
});

test('restore a purchase by email + purchase id, or by pasting a token', async ({ page, billing }) => {
  billing.purchases.set('dp_restore0000000000001', { email: 'learner@example.org', sku: 'pass-year' });
  await onboard(page);
  await page.goto('/unlock#u-restore');
  await page.getByRole('textbox', { name: 'Email used at checkout' }).fill('someone@example.org');
  await page.getByRole('textbox', { name: 'Purchase id' }).fill('dp_restore0000000000001');
  await page.getByRole('button', { name: 'Restore purchase' }).click();
  await expect(page.getByRole('alert')).toContainText('No purchase matches');

  await page.getByRole('textbox', { name: 'Email used at checkout' }).fill('learner@example.org');
  await page.getByRole('button', { name: 'Restore purchase' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'unlocked until' })).toContainText('All levels for a year');
  await expectA2Open(page);

  // A second device: paste a token (works offline).
  const other = await page.context().browser()!.newContext();
  try {
    const p2 = await other.newPage();
    await onboard(p2);
    await other.setOffline(true);
    await p2.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name: 'Settings' }).click();
    await p2.getByRole('link', { name: 'Unlock levels' }).click();
    await p2.getByRole('textbox', { name: 'Unlock token' }).fill(await testToken('level-a2'));
    await p2.getByRole('button', { name: 'Add token' }).click();
    await expect(p2.getByRole('status').filter({ hasText: 'A2 unlocked' })).toBeVisible();
    await expect(p2.getByRole('status', { name: 'Unlocked on this device' })).toContainText('A2');
    // A forged token is refused.
    const forged = (await testToken('pass-year')).replace(/.{4}$/, 'AAAA');
    await p2.getByRole('textbox', { name: 'Unlock token' }).fill(forged);
    await p2.getByRole('button', { name: 'Add token' }).click();
    await expect(p2.getByRole('alert')).toContainText(/not valid|doesn't look like/);
  } finally {
    await other.close();
  }
});

test('the billing origin is the mock (sanity check of the payments build)', async ({ page }) => {
  await page.goto('/welcome');
  const status = await page.evaluate(async (origin) => (await fetch(`${origin}/v1/nothing`, { method: 'POST', body: '{}' })).status, BILLING_ORIGIN);
  expect(status).toBe(404);
});

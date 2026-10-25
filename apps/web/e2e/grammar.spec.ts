import type { Page } from '@playwright/test';
import { exercisesFor, grammarIndex, searchGrammar } from '../src/lib/grammar';
import { a1Pack, expect, onboard, test } from './fixtures';

const entries = () => grammarIndex([a1Pack()]);

/** Desktop: the "Reference" sidebar; phones: the card on Learn (the tab bar stays at five). */
async function openGrammar(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Reference' });
  if (await sidebar.isVisible()) await sidebar.getByRole('link', { name: 'Grammar' }).click();
  else await page.getByRole('link', { name: /Grammar reference/ }).click();
  await expect(page).toHaveURL(/\/grammar$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Grammar reference' })).toBeVisible();
}

test.describe('grammar reference', () => {
  test('lists every grammar point by level and unit', async ({ page }) => {
    const all = entries();
    await onboard(page);
    await openGrammar(page);
    await expect(page.getByRole('search').getByRole('status')).toHaveText(`${all.length} grammar points`);
    const a1 = page.getByRole('region', { name: 'A1' });
    for (const u of a1Pack().units) {
      const list = a1.getByRole('list', { name: `Unit ${u.number} grammar` });
      await expect(list.getByRole('link')).toHaveText(u.grammar.map((g) => g.title));
    }
  });

  test('search ignores accents and accepts ae/oe/ue and ss', async ({ page }) => {
    const all = entries();
    await onboard(page);
    await openGrammar(page);
    const search = page.getByRole('searchbox', { name: 'Search grammar' });
    const status = page.getByRole('search').getByRole('status');
    const results = page.getByRole('list', { name: 'Search results' }).getByRole('listitem');

    for (const q of ['mochte', 'moechte', 'MÖCHTE', 'kuche', 'heisst']) {
      const expected = searchGrammar(all, q);
      expect(expected.length, `content has a match for "${q}"`).toBeGreaterThan(0);
      await search.fill(q);
      await expect(status).toHaveText(`${expected.length} grammar point${expected.length === 1 ? '' : 's'} found`);
      await expect(results).toHaveCount(expected.length);
      await expect(results.first()).toContainText(expected[0]!.point.title);
    }
    // "möchte" with and without umlaut finds the same point, title match first.
    await search.fill('mochte');
    await expect(results.first()).toContainText('möchte(n)');

    await search.fill('zzzqqq');
    await expect(status).toHaveText('0 grammar points found');
    await expect(page.getByText('Nothing matches “zzzqqq”.')).toBeVisible();
    await search.fill('');
    await expect(status).toHaveText(`${all.length} grammar points`);
  });

  test('detail view: the point, its exercises and the way back to the unit', async ({ page }) => {
    const entry = entries().find((e) => exercisesFor(e.unit, e.point.id).length > 0)!;
    const practice = exercisesFor(entry.unit, entry.point.id);
    await onboard(page);
    await openGrammar(page);
    await page.getByRole('searchbox', { name: 'Search grammar' }).fill(entry.point.title);
    await page.getByRole('list', { name: 'Search results' }).getByRole('link', { name: new RegExp(entry.point.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();

    await expect(page).toHaveURL(`/grammar/${entry.unit.id}/${entry.point.id}`);
    await expect(page.getByRole('heading', { level: 1, name: entry.point.title })).toBeVisible();
    const box = page.getByRole('region', { name: 'Practise this' });
    await expect(box.getByRole('listitem')).toHaveCount(practice.length);
    await expect(box.getByRole('link', { name: `Back to unit ${entry.unit.number}: ${entry.unit.title}` })).toBeVisible();

    // A practice link opens that exercise in its unit step.
    const first = practice[0]!;
    await box.getByRole('listitem').first().getByRole('link').click();
    await expect(page).toHaveURL(`/unit/${entry.unit.id}/${first.step}?item=${first.ex.id}`);
    await expect(page.getByRole('heading', { level: 3, name: first.ex.prompt })).toBeVisible();

    await page.goBack();
    await page.getByRole('link', { name: '← All grammar' }).click();
    await expect(page).toHaveURL(/\/grammar$/);
  });

  test('an unknown grammar point shows a not-found state', async ({ page }) => {
    await onboard(page);
    await page.goto('/grammar/a1-u01/does-not-exist');
    await expect(page.getByRole('heading', { name: 'Grammar point not found' })).toBeVisible();
    await page.getByRole('link', { name: 'All grammar' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Grammar reference' })).toBeVisible();
  });
});

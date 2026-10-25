// v0.5 beta build: anonymous item statistics (opt-in, once a day), opt-out with /v1/forget, and
// crash reports (opt-in, scrubbed on the device) with the friendly reload screen.
import type { Page } from '@playwright/test';
import { firstOfType, navTo, onboard, openItem, answerCorrectly, uebungen, unit1 } from '../fixtures';
import { expect, patchSettings, putRows, readAll, readSettings, test, until } from './collector';

const introCard = (page: Page) => page.getByRole('region', { name: 'Help improve Doppelpunkt (beta)' });
const statsBox = (page: Page) => page.getByRole('checkbox', { name: /Share anonymous item statistics/ });
const crashBox = (page: Page) => page.getByRole('checkbox', { name: /Send crash reports/ });

/** Local calendar day, as the app's todayKey() computes it. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('item statistics', () => {
  test.use({ allowConsole: [/ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/] });

  test('opt in → one StatsBatch upload a day (day only, at most 200 items per batch); opt out → /v1/forget and the id is gone', async ({ page, context, collector }) => {
    test.setTimeout(60_000);
    await onboard(page);
    // The boxes follow the stored choice, so click and wait (check() expects an immediate change).
    await statsBox(page).click();
    await expect(statsBox(page)).toBeChecked();
    await expect(introCard(page).getByRole('status')).toHaveText('Thanks! Anonymous item statistics are on.');
    await introCard(page).getByRole('button', { name: 'Done' }).click();
    const { beta } = await readSettings(page);
    expect(beta).toMatchObject({ stats: true, crashes: false });
    const installId = beta!.installId!;
    expect(installId).toMatch(/^[a-f0-9]{32}$/);

    // One real answer, plus 449 seeded aggregates (more than two batches' worth).
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'mcq');
    // Offline while practising, so the start-up sync can't upload half of it; going online syncs.
    await openItem(page, unit, ex);
    await context.setOffline(true);
    await answerCorrectly(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('region', { name: 'Result' })).toBeVisible();
    await expect.poll(async () => (await readAll(page, 'itemStats')).map((r) => r.itemId)).toContain(ex.id);
    const seeded = Array.from({ length: 449 }, (_, i) => ({ itemId: `a1-u02-seeded-${String(i).padStart(3, '0')}`, attempts: 2, buckets: [1, 0, 0], seconds: 12.4 }));
    await putRows(page, 'itemStats', seeded);
    await page.waitForTimeout(3_500);
    expect(collector.calls).toEqual([]);
    await context.setOffline(false);
    await until(() => collector.stats().length, 'statistics uploaded');
    await expect.poll(() => collector.stats().reduce((n, b) => n + b.items.length, 0)).toBe(450);
    const batches = collector.stats();
    expect(batches.map((b) => b.items.length)).toEqual([200, 200, 50]);
    for (const b of batches) {
      expect(Object.keys(b).sort()).toEqual(expect.arrayContaining(['appVersion', 'contentVersion', 'day', 'installId', 'items', 'kind']));
      expect(Object.keys(b).every((k) => ['appVersion', 'band', 'contentVersion', 'day', 'installId', 'items', 'kind'].includes(k))).toBe(true);
      expect(b.day).toBe(today());
      expect(b.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(b.installId).toBe(installId);
      for (const it of b.items) {
        expect(Object.keys(it).sort()).toEqual(['attempts', 'buckets', 'itemId', 'seconds']);
        expect(it.seconds % 5).toBe(0);
      }
    }
    const mine = batches.flatMap((b) => b.items).find((i) => i.itemId === ex.id)!;
    expect(mine).toMatchObject({ attempts: 1, buckets: [0, 0, 1] });
    // Nothing else is in the request: no answers, no timestamps finer than the day.
    const body = collector.ingestCalls().map((c) => c.text).join('\n');
    expect(body).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect((await readAll(page, 'itemStats')).length).toBe(0);
    expect((await readSettings(page)).beta?.lastStatsDay).toBe(today());

    // More practice the same day: counted locally, but not uploaded again until tomorrow.
    await openItem(page, unit, ex);
    await answerCorrectly(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect.poll(async () => (await readAll(page, 'itemStats')).length).toBe(1);
    await page.reload();
    await page.waitForTimeout(4_000);
    expect(collector.stats()).toHaveLength(3);
    expect(collector.ingestCalls().filter((c) => c.status === 200)).toHaveLength(collector.ingestCalls().length);

    // Opt out in Settings: the collector is asked to forget the id; the id and the local counts are deleted.
    await navTo(page, 'Settings');
    await expect(page.getByText(`Your random beta id: ${installId.slice(0, 8)}…`)).toBeVisible();
    await statsBox(page).click();
    await expect(statsBox(page)).not.toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Item statistics are off.' })).toHaveText(
      'Item statistics are off. Your random id was deleted and the server asked to forget it.',
    );
    await until(() => collector.forgetCalls().length, '/v1/forget called');
    expect(collector.forgetCalls().map((c) => c.body)).toEqual([{ installId }]);
    const after = (await readSettings(page)).beta!;
    expect(after.stats).toBe(false);
    expect(after.installId).toBeUndefined();
    expect(after.pendingForget).toBeUndefined();
    expect(await readAll(page, 'itemStats')).toEqual([]);
    await expect(page.getByText(/Your random beta id/)).toHaveCount(0);

    // Opting in again makes a new id.
    await statsBox(page).click();
    await expect(page.getByText(/Your random beta id/)).toBeVisible();
    const again = (await readSettings(page)).beta!.installId!;
    expect(again).toMatch(/^[a-f0-9]{32}$/);
    expect(again).not.toBe(installId);
  });
});

test.describe('crash reports', () => {
  const FAKE_KEY = 'sk-ant-api03-e2eFAKEkey0123456789abcdefghijklmnopqrstuvwxyz';
  // One pattern: test.use() reads an array of two or more RegExps as [value, options].
  test.use({ allowConsole: [/e2e crash|perLevel|React Router caught the following error|The above error occurred/] });

  test('opt in → an error is reported without key-like strings; a broken screen shows the friendly reload screen', async ({ page, collector }) => {
    await onboard(page);
    await introCard(page).getByRole('button', { name: 'Not now' }).click();

    // A fake Anthropic key in Settings (stored encrypted, unlocked for this session).
    await navTo(page, 'Settings');
    const card = page.getByRole('group', { name: 'Anthropic (Claude)' });
    await card.getByLabel('API key').fill(FAKE_KEY);
    await card.getByLabel('Passphrase').fill('correct horse battery');
    await card.getByRole('button', { name: 'Save key' }).click();
    await expect(card.getByRole('status')).toHaveText('Key saved and unlocked.');

    await crashBox(page).click();
    await expect(crashBox(page)).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Crash reports are on.' })).toBeVisible();

    // An uncaught error whose message and stack carry the key, an email address and a URL with a query.
    await page.evaluate((key) => {
      setTimeout(() => {
        const e = new Error(`e2e crash: request with x-api-key: ${key} for anna.muster@example.ch failed at https://api.anthropic.com/v1/messages?key=${key}`);
        e.stack = `Error: ${e.message}\n    at send (https://localhost:4320/assets/ai-abc123.js:1:2345?token=${key})\n    at Bearer ${key}`;
        throw e;
      });
    }, FAKE_KEY);
    await until(() => collector.crashes().length, 'the crash report is sent');
    const [report] = collector.crashes();
    const text = JSON.stringify(report);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toMatch(/sk-ant-|sk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{32,}/);
    expect(text).not.toContain('anna.muster');
    expect(text).not.toContain('/v1/messages');
    expect(report).toMatchObject({ kind: 'crash', name: 'Error', route: '/settings' });
    expect(report!.message).toContain('[key]');
    expect(report!.message).toContain('[email]');
    expect(report!.message).toContain('https://api.anthropic.com');
    expect(report!.stack).toContain('ai-abc123.js:1:2345');
    expect(report!.browser).toMatch(/^Chrome \d+$/);

    // A screen that breaks while rendering (a corrupt placement result in the settings row).
    await patchSettings(page, { placement: { at: '2026-10-01T10:00:00.000Z', level: 'A1', unit: 1, perLevel: { length: 1 }, answered: 1, total: 1, durationSec: 1, stoppedEarly: false } });
    await page.goto('/progress');
    const crash = page.getByRole('alert').filter({ has: page.getByRole('heading', { name: 'Something went wrong' }) });
    await expect(crash).toBeVisible();
    await expect(crash).toContainText('Your progress is saved on this device. Reloading usually fixes it.');
    await expect(crash.getByRole('button', { name: 'Reload' })).toBeVisible();
    await until(() => collector.crashes().some((c) => c.route === '/progress'), 'the render crash is reported');
    const render = collector.crashes().find((c) => c.route === '/progress')!;
    expect(render.message).toMatch(/perLevel/);
    expect(JSON.stringify(collector.crashes())).not.toMatch(/sk-ant-|[A-Za-z0-9_-]{32,}/);

    // "Go to Learn" leaves the broken screen.
    await crash.getByRole('link', { name: 'Go to Learn' }).click();
    await expect(page.getByRole('list', { name: 'A1 units' })).toBeVisible();
  });

  test('crash reports off (the default): an error is not reported', async ({ page, collector }) => {
    await onboard(page);
    await introCard(page).getByRole('button', { name: 'Not now' }).click();
    await page.evaluate(() => setTimeout(() => {
      throw new Error('e2e crash: not reported');
    }));
    await patchSettings(page, { placement: { at: '2026-10-01T10:00:00.000Z', level: 'A1', unit: 1, perLevel: { length: 1 }, answered: 1, total: 1, durationSec: 1, stoppedEarly: false } });
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
    await page.waitForTimeout(4_000);
    expect(collector.calls).toEqual([]);
  });
});

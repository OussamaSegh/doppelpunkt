// v0.5 beta build (VITE_COLLECTOR_URL set): consent, "Report a problem", the offline outbox, the
// 413 split, and the /beta and /privacy screens. The collector is mocked (./collector.ts).
import type { Page } from '@playwright/test';
import type { FeedbackReport } from '@doppelpunkt/beta-schema';
import { firstOfType, navTo, onboard, openItem, answerCorrectly, result, uebungen, unit1 } from '../fixtures';
import { COLLECTOR_ORIGIN, expect, queueReports, readAll, readSettings, test, until } from './collector';

const introCard = (page: Page) => page.getByRole('region', { name: 'Help improve Doppelpunkt (beta)' });
const statsBox = (page: Page) => page.getByRole('checkbox', { name: /Share anonymous item statistics/ });
const crashBox = (page: Page) => page.getByRole('checkbox', { name: /Send crash reports/ });

/** Onboards and closes the one-time beta card with everything left off. */
async function onboardNoOptIn(page: Page) {
  await onboard(page);
  await introCard(page).getByRole('button', { name: 'Not now' }).click();
  await expect(introCard(page)).toHaveCount(0);
}

/** Answers unit 1's first multiple-choice item and opens the report form; returns the preview JSON. */
async function openReportForm(page: Page) {
  const unit = unit1();
  const { ex } = firstOfType(uebungen(unit), 'mcq');
  await openItem(page, unit, ex);
  await answerCorrectly(page, ex);
  await page.getByRole('button', { name: 'Check' }).click();
  await result(page).getByRole('button', { name: 'Report a problem' }).click();
  const form = page.getByRole('form', { name: 'Report a problem' });
  await expect(form).toBeVisible();
  return { form, ex, unit };
}

// Requests that fail while the device is offline.
const OFFLINE = /ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/;

test.describe('beta consent', () => {
  test.use({ allowConsole: [/not reported: no opt-in/] });
  test('the intro card shows once, both opt-ins start off, and nothing is sent before opting in', async ({ page, collector }) => {
    await onboard(page);
    const card = introCard(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Everything is off unless you turn it on');
    await expect(statsBox(page)).not.toBeChecked();
    await expect(crashBox(page)).not.toBeChecked();
    await expect(card.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');

    // Even an uncaught error is not reported without the crash opt-in.
    await page.evaluate(() => setTimeout(() => Promise.reject(new Error('not reported: no opt-in'))));
    // The app syncs 3 s after start; let that pass.
    await page.waitForTimeout(4_000);
    await card.getByRole('button', { name: 'Not now' }).click();
    await expect(card).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('list', { name: 'A1 units' })).toBeVisible();
    await expect(introCard(page)).toHaveCount(0);
    const settings = await readSettings(page);
    expect(settings.beta).toMatchObject({ stats: false, crashes: false, introDone: true });
    expect(settings.beta?.installId).toBeUndefined();

    // Settings shows the same choices, still off.
    await navTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Help improve Doppelpunkt (beta)' })).toBeVisible();
    await expect(statsBox(page)).not.toBeChecked();
    await expect(crashBox(page)).not.toBeChecked();
    await page.waitForTimeout(3_500);
    expect(collector.requests, 'no request to the collector before any opt-in or report').toEqual([]);
  });
});

test.describe('Report a problem', () => {
  test.use({ allowConsole: [OFFLINE] });
  test('the preview is exactly the request body; the report shows under My reports', async ({ page, collector }) => {
    await onboardNoOptIn(page);
    const { form, ex, unit } = await openReportForm(page);
    await expect(form.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(form).toContainText("Choose what's wrong to see the report.");
    await form.getByText('Unclear', { exact: true }).click();
    // Enter on a reason belongs to the form, not to the exercise (which would move to the next item).
    await form.getByRole('radio', { name: 'Unclear' }).press('Enter');
    await expect(form).toBeVisible();
    await form.getByLabel('Comment (optional)').fill('The explanation does not say why.');
    await form.getByRole('checkbox', { name: 'Include my answer' }).check();
    await expect(form.locator('pre')).toContainText('"answer"');
    const preview = JSON.parse((await form.locator('pre').textContent())!) as FeedbackReport;
    expect(preview).toMatchObject({ kind: 'feedback', itemId: ex.id, unitId: unit.id, reason: 'unclear', comment: 'The explanation does not say why.' });
    expect(preview.answer).toBeTruthy();
    expect(Object.keys(preview).sort()).toEqual(['answer', 'appVersion', 'at', 'comment', 'contentVersion', 'itemId', 'kind', 'reason', 'unitId']);

    await form.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Sent. Thank you!' })).toBeVisible();
    const calls = collector.ingestCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual([preview]);
    expect(JSON.parse(calls[0]!.text)).toEqual([preview]);

    await page.getByRole('link', { name: 'My reports' }).click();
    await expect(page).toHaveURL(/\/beta#reports$/);
    const mine = page.getByRole('list', { name: 'My reports' }).getByRole('listitem');
    await expect(mine).toHaveCount(1);
    await expect(mine.first()).toContainText(`Unclear · ${ex.id}`);
    await expect(mine.first()).toContainText('Sent');
    await expect(mine.first()).toContainText('The explanation does not say why.');
  });

  test('offline: the report waits on the device and goes out when the device is back online', async ({ page, context, collector }) => {
    await onboardNoOptIn(page);
    const { form } = await openReportForm(page);
    await context.setOffline(true);
    await form.getByText('Typo', { exact: true }).click();
    const preview = JSON.parse((await form.locator('pre').textContent())!) as FeedbackReport;
    await form.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('status').filter({ hasText: "Saved. Will send when you're online." })).toBeVisible();
    // Waits on the device (screens can't be opened offline here: service workers are blocked in this suite).
    expect(await readAll(page, 'outbox')).toHaveLength(1);
    expect((await readAll(page, 'reports')).map((r) => r.status)).toEqual(['queued']);
    await page.waitForTimeout(1_000);
    expect(collector.calls).toEqual([]);

    await context.setOffline(false);
    await until(() => collector.feedback().length, 'the queued report is sent after the online event');
    expect(collector.feedback()).toEqual([preview]);
    expect(collector.ingestCalls()).toHaveLength(1);
    await page.getByRole('link', { name: 'My reports' }).click();
    await expect(page.getByRole('region', { name: 'Waiting to be sent' })).toContainText('Online. Nothing is waiting.');
    await expect(page.getByRole('list', { name: 'My reports' }).getByRole('listitem').first()).toContainText('Sent');
    expect(await readAll(page, 'outbox')).toEqual([]);
  });
});

test.describe('outbox batching', () => {
  test.use({ allowConsole: [OFFLINE] });
  test('413 from the collector: the batch is split in halves until it fits; a single envelope that is too large is refused', async ({ page, context, collector }) => {
    await onboardNoOptIn(page);
    const base: FeedbackReport = {
      kind: 'feedback',
      appVersion: '0.5.0',
      contentVersion: '0.4.0',
      itemId: 'a1-u01-mcq-greeting',
      unitId: 'a1-u01',
      reason: 'typo',
      at: '2026-10-25T10:00:00.000Z',
    };
    const small = Array.from({ length: 6 }, (_, i) => ({ ...base, itemId: `a1-u01-item-${i + 1}`, at: `2026-10-25T10:00:0${i}.000Z` }));
    const big: FeedbackReport = { ...base, itemId: 'a1-u01-item-big', reason: 'other', comment: 'x'.repeat(500), answer: 'y'.repeat(300) };
    // Three small envelopes fit; four don't; the big one never does.
    const limit = Buffer.byteLength(JSON.stringify(small.slice(0, 3))) + 8;
    expect(Buffer.byteLength(JSON.stringify([big]))).toBeGreaterThan(limit);
    collector.maxBodyBytes = limit;
    // Queue while offline so that no sync sees half of them; going online syncs all seven at once.
    await context.setOffline(true);
    await queueReports(page, [...small, big]);
    expect(await readAll(page, 'outbox')).toHaveLength(7);
    await context.setOffline(false);
    await until(() => collector.feedback().length >= 6 && collector.ingestCalls().some((c) => c.status === 413 && (c.body as unknown[]).length === 1), 'all small reports sent, the big one refused');

    const sizes = collector.ingestCalls().map((c) => `${(c.body as unknown[]).length}:${c.status}`);
    // 7 → 413; 4 → 413; 2 + 2 ok; 3 (2 small + big) → 413; 2 ok; 1 (big) → 413, refused for good.
    expect(sizes).toEqual(['7:413', '4:413', '2:200', '2:200', '3:413', '2:200', '1:413']);
    expect(collector.ingestCalls().filter((c) => c.status === 200).every((c) => c.bytes <= limit)).toBe(true);
    expect(collector.feedback().map((f) => f.itemId)).toEqual(small.map((s) => s.itemId));

    await page.goto('/beta');
    await expect(page.getByRole('region', { name: 'Waiting to be sent' })).toContainText('Nothing is waiting.');
    const mine = page.getByRole('list', { name: 'My reports' }).getByRole('listitem');
    await expect(mine).toHaveCount(7);
    // Newest first: the big one.
    await expect(mine.first()).toContainText('Not accepted');
    await expect(mine.first()).toContainText('The beta server refused it (HTTP 413).');
    await expect(mine.filter({ hasText: 'Sent' })).toHaveCount(6);
  });
});

test.describe('beta screens', () => {
  test('/beta: what is new, how to report, the outbox and my reports; linked from Learn', async ({ page, collector }) => {
    await onboardNoOptIn(page);
    await page.getByRole('link', { name: /Beta feedback/ }).first().click();
    await expect(page).toHaveURL(/\/beta$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Doppelpunkt beta' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /^What's new in / })).toBeVisible();
    await expect(page.getByRole('region', { name: 'How to give feedback' })).toContainText('Report a problem');
    await expect(page.getByRole('region', { name: 'Waiting to be sent' })).toContainText('Nothing is waiting.');
    await expect(page.getByRole('region', { name: 'Waiting to be sent' })).toContainText('Item statistics: off. Crash reports: off.');
    await expect(page.getByRole('region', { name: 'My reports' })).toContainText("You haven't reported anything yet.");
    await expect(page.getByText('The beta programme is not active in this build')).toHaveCount(0);
    expect(collector.calls).toEqual([]);
  });

  test('/privacy: the learner notice without the operator notes, and a way to change the choices', async ({ page }) => {
    await onboardNoOptIn(page);
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();
    await expect(page.getByText('The beta programme is not active in this build')).toHaveCount(0);
    const article = page.getByRole('article');
    await expect(article.getByRole('heading').first()).toBeVisible();
    await expect(article).not.toContainText('Notes for the operator');
    await page.getByRole('link', { name: 'Change your beta choices in Settings' }).click();
    await expect(page).toHaveURL(/\/settings#s-beta$/);
    await expect(statsBox(page)).toBeVisible();
  });

  test('the collector origin is the mock (sanity check of the beta build)', async ({ page, collector }) => {
    await page.goto('/welcome');
    const res = await page.evaluate(async (origin) => (await fetch(`${origin}/v1/health`)).json(), COLLECTOR_ORIGIN);
    expect(res).toEqual({ ok: true });
    expect(collector.calls.map((c) => c.path)).toEqual(['/v1/health']);
  });
});

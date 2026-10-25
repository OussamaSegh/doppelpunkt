import type { Page, Route } from '@playwright/test';
import { expect, navTo, onboard, test } from './fixtures';

const FAKE_KEY = 'sk-ant-test-0000000000000000';
const PASS = 'correct horse battery';

const anthropicCard = (page: Page) => page.getByRole('group', { name: 'Anthropic (Claude)' });

async function saveAnthropicKey(page: Page) {
  await navTo(page, 'Settings');
  const card = anthropicCard(page);
  await expect(card).toContainText('No key');
  await card.getByLabel('API key').fill(FAKE_KEY);
  await card.getByLabel('Passphrase').fill(PASS);
  await card.getByRole('button', { name: 'Save key' }).click();
  await expect(card.getByRole('status')).toHaveText('Key saved and unlocked.');
  await expect(card).toContainText('Unlocked');
}

test('settings: save an Anthropic key with a passphrase, lock, unlock and forget it', async ({ page }) => {
  await onboard(page);
  await saveAnthropicKey(page);
  const card = anthropicCard(page);

  // The key is stored encrypted, never in plain text.
  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('doppelpunkt');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('aiKeys', 'readonly');
          const all = tx.objectStore('aiKeys').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => reject(all.error);
        };
      }),
  );
  expect(stored).toContain('anthropic');
  expect(stored).not.toContain(FAKE_KEY);

  await card.getByRole('button', { name: 'Lock' }).click();
  await expect(card).toContainText('Locked');

  await card.getByLabel('Passphrase').fill('wrong passphrase');
  await card.getByRole('button', { name: 'Unlock' }).click();
  await expect(card.getByRole('alert')).toHaveText('Wrong passphrase.');

  await card.getByLabel('Passphrase').fill(PASS);
  await card.getByRole('button', { name: 'Unlock' }).click();
  await expect(card.getByRole('status')).toHaveText('Unlocked for this session.');
  await expect(card).toContainText('Unlocked');

  await card.getByRole('button', { name: 'Forget key' }).click();
  await expect(card.getByRole('status')).toHaveText('Key removed from this device.');
  await expect(card).toContainText('No key');
  await expect(card.getByLabel('API key')).toBeVisible();
});

test('settings: a short passphrase is rejected', async ({ page }) => {
  await onboard(page);
  await navTo(page, 'Settings');
  const card = anthropicCard(page);
  await card.getByLabel('API key').fill(FAKE_KEY);
  await card.getByLabel('Passphrase').fill('short');
  await card.getByRole('button', { name: 'Save key' }).click();
  await expect(card.getByRole('alert')).toHaveText('Use a passphrase of at least 8 characters.');
  await expect(card).toContainText('No key');
});

test('tutor without a key asks the learner to add one', async ({ page }) => {
  await onboard(page);
  await navTo(page, 'Tutor');
  await expect(page.getByRole('heading', { name: 'Talk with a tutor' })).toBeVisible();
  await expect(page.getByText('Add an AI key in Settings to get AI feedback.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Open Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test.describe('tutor with a key', () => {
  // Service workers can swallow requests before page.route sees them; keep the mock deterministic.
  test.use({ serviceWorkers: 'block' });

  test('streams the reply from a mocked Anthropic API', async ({ page }) => {
    const requests: Array<{ headers: Record<string, string>; body: { model?: string; stream?: boolean; system?: unknown; messages?: unknown[] } }> = [];
    const deltas = ['Hallo! ', 'Ich bin Lena. ', 'Wie heißt du?'];

    await page.route('https://api.anthropic.com/**', async (route: Route) => {
      const req = route.request();
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      requests.push({ headers: req.headers(), body: req.postDataJSON() });
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        ...deltas.map((text) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 14 } },
        { type: 'message_stop' },
      ];
      const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body });
    });

    await onboard(page);
    await saveAnthropicKey(page);
    await navTo(page, 'Tutor');

    await expect(page.getByRole('heading', { name: 'Tutor', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Lena/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Provider')).toContainText('Anthropic (Claude)');

    const convo = page.getByLabel('Conversation');
    await page.getByLabel('Message').fill('Hallo Lena!');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(convo).toContainText('Hallo Lena!');
    await expect(convo).toContainText(deltas.join('').trim());
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();

    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent!.headers['x-api-key']).toBe(FAKE_KEY);
    expect(sent!.headers['anthropic-version']).toBeTruthy();
    expect(sent!.body.stream).toBe(true);
    expect(JSON.stringify(sent!.body.messages)).toContain('Hallo Lena!');

    // The cost meter picks up the reported usage.
    await expect(page.getByLabel('AI cost')).not.toContainText('This chat: $0.0000');
  });
});

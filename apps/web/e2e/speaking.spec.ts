import type { Page, Route } from '@playwright/test';
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { grade } from '@doppelpunkt/engine';
import { resultTone } from '../src/lib/feedback';
import { detectPlatform, micFixSteps } from '../src/lib/speech';
import { a1Pack, escapeRegExp, expect, navTo, onboard, openItem, result, test, uebungen } from './fixtures';
import { fakeMic, storedAttempts, stubMedia, ttsCalls } from './media';

type Speak = Extract<Exercise, { type: 'speak' }>;

/** The first Standard German speak item of the A1 pack (optionally one whose target matches). */
function speakItem(match: (ex: Speak) => boolean = () => true): { unit: CompiledUnit; ex: Speak; index: number } {
  for (const unit of a1Pack().units) {
    const list = uebungen(unit);
    const index = list.findIndex((e) => e.type === 'speak' && e.variety === 'de' && match(e));
    if (index >= 0) return { unit, ex: list[index] as Speak, index };
  }
  throw new Error('no matching speak exercise in A1');
}

const recorder = (page: Page) => page.getByTestId('recorder');
const heardField = (page: Page) => page.getByLabel('What we heard (you can correct it)');

/** Record → wait for at least a second of audio → stop; checks the recording UI on the way. */
async function recordOnce(page: Page) {
  const rec = recorder(page);
  await rec.getByRole('button', { name: 'Record', exact: true }).click();
  const stop = rec.getByRole('button', { name: 'Stop recording' });
  await expect(stop).toBeVisible();
  await expect(rec.getByRole('timer')).toContainText(/Recording 0:0[1-9]/, { timeout: 5_000 });
  await stop.click();
  await expect(rec.getByRole('button', { name: 'Record again' })).toBeVisible();
}

async function expectPlayback(page: Page) {
  const you = page.getByLabel('Your recording');
  await expect(you).toBeVisible();
  await expect(you).toHaveAttribute('src', /^blob:/);
  // The fake device's beep is a real, decodable recording.
  await expect.poll(() => you.evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 5_000 }).toBeGreaterThan(0);
}

// Chromium's fake microphone for the whole file (launch options can't change per describe block).
test.use({ launchOptions: fakeMic.launchOptions });

test.describe('speaking with a fake microphone', () => {
  test.use({ permissions: fakeMic.permissions });

  test('record, stop, play back, then rate yourself; the score feeds the radar', async ({ page }) => {
    await stubMedia(page, { recognition: false });
    const { unit, ex } = speakItem();
    await onboard(page);
    await openItem(page, unit, ex);

    await expect(recorder(page).getByText('Not recorded yet.')).toBeVisible();
    await expect(recorder(page).getByRole('button', { name: 'Play native (synthetic voice)' })).toBeVisible();
    await expect(page.getByText("Your browser can't recognise speech.", { exact: false })).toBeVisible();
    await recordOnce(page);
    await expectPlayback(page);

    // Native playback uses the German TTS voice for Standard German.
    await recorder(page).getByRole('button', { name: 'Play native (synthetic voice)' }).click();
    await expect.poll(async () => (await ttsCalls(page)).at(-1)).toMatchObject({ text: ex.target, lang: 'de-DE', rate: 1 });

    // Without recognition or an AI key there is nothing to type into: only self-rating.
    await expect(heardField(page)).toHaveCount(0);
    await page.getByRole('group', { name: 'Rate yourself' }).getByRole('button', { name: 'Sounded right' }).click();
    await expect(page.getByText('You rated this: Sounded right.')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Self-rated' })).toBeVisible();
    await expect(page.getByText(ex.explanation, { exact: true })).toBeVisible();

    expect((await storedAttempts(page)).filter((a) => a.exerciseId === ex.id)).toMatchObject([{ skill: 'speaking', score: 1 }]);
    await navTo(page, 'Progress');
    await expect(page.getByRole('img', { name: 'Skill radar chart' })).toBeVisible();
    const speaking = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Speaking', exact: true }) });
    await expect(speaking.getByRole('cell').nth(1)).not.toHaveText('–');
    await expect(speaking.getByRole('cell').nth(2)).toContainText('(1)');
  });

  test('browser recognition fills the transcript; a corrected transcript is graded word by word with sound hints', async ({ page }) => {
    // The learner says u for ü and stops halfway (first item where that gives a sound hint).
    const attempt = (e: Speak) => {
      const words = e.target.split(/\s+/);
      return { words, said: words.slice(0, Math.ceil(words.length / 2)).join(' ').replace(/ü/g, 'u') };
    };
    const { unit, ex } = speakItem((e) => {
      const g = grade(e, attempt(e).said);
      return !g.correct && (g.hints?.length ?? 0) > 0;
    });
    const { words, said } = attempt(ex);
    const expected = grade(ex, said);

    await stubMedia(page, { recognition: ex.target });
    await onboard(page);
    await openItem(page, unit, ex);
    await expect(page.getByText('Speech recognition: your browser (de-DE).')).toBeVisible();

    await recordOnce(page);
    await expectPlayback(page);
    await expect(heardField(page)).toHaveValue(ex.target);
    await expect(page.getByRole('status').filter({ hasText: 'Recognised by your browser (de-DE)' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __recognitionLangs: string[] }).__recognitionLangs)).toEqual(['de-DE']);

    await heardField(page).fill(said);
    await expect(page.getByRole('status').filter({ hasText: 'Recognised by your browser (de-DE), corrected by you' })).toBeVisible();
    await page.getByRole('button', { name: 'Check', exact: true }).click();

    await expect(result(page)).toHaveAttribute('data-tone', resultTone(expected));
    const diff = result(page).getByLabel('Word by word comparison');
    await expect(diff).toBeVisible();
    await expect(diff).toContainText('(missing)');
    await expect(diff).toContainText(words.at(-1)!.replace(/[.?!,]+$/, ''));
    const tips = page.getByRole('region', { name: 'Pronunciation tips' });
    await expect(tips).toContainText('Sounds to work on');
    await expect(tips).toContainText(expected.hints![0]!.label);
    await expect
      .poll(async () => (await storedAttempts(page)).filter((a) => a.exerciseId === ex.id).map((a) => a.score))
      .toEqual([expected.score]);
  });

  test('Swiss Standard German items listen in de-CH', async ({ page }) => {
    let found: { unit: CompiledUnit; ex: Speak } | undefined;
    for (const unit of a1Pack().units) {
      const ex = uebungen(unit).find((e): e is Speak => e.type === 'speak' && e.variety === 'ch-std');
      if (ex) found = found ?? { unit, ex };
    }
    expect(found, 'A1 has a ch-std speak item').toBeTruthy();
    const { unit, ex } = found!;
    await stubMedia(page, { recognition: ex.target });
    await onboard(page);
    await openItem(page, unit, ex);
    await recordOnce(page);
    await expect(heardField(page)).toHaveValue(ex.target);
    await expect(page.getByRole('status').filter({ hasText: 'Recognised by your browser (de-CH)' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __recognitionLangs: string[] }).__recognitionLangs)).toEqual(['de-CH']);
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(result(page)).toHaveAttribute('data-tone', 'right');
  });

  test('shadowing: "Listen, then speak" plays the model at the chosen speed and starts recording', async ({ page }) => {
    await stubMedia(page, { recognition: false });
    const { unit, ex } = speakItem();
    await onboard(page);
    await openItem(page, unit, ex);
    await page.getByRole('checkbox', { name: 'Shadowing mode' }).check();
    const speed = recorder(page).getByRole('radiogroup', { name: 'Speed' });
    await expect(speed.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
    await speed.getByRole('radio', { name: '0.75×' }).click();
    await expect(speed.getByRole('radio', { name: '0.75×' })).toHaveAttribute('aria-checked', 'true');
    await recorder(page).getByRole('button', { name: 'Listen, then speak' }).click();
    await expect(recorder(page).getByRole('button', { name: 'Stop recording' })).toBeVisible();
    expect((await ttsCalls(page)).at(-1)).toMatchObject({ text: ex.target, rate: 0.75 });
    await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
    await expect(recorder(page).getByRole('button', { name: 'Record again' })).toBeVisible();
    await expectPlayback(page);
  });

  test.describe('provider transcription fallback', () => {
    // Service workers can swallow requests before page.route sees them; keep the mock deterministic.
    test.use({ serviceWorkers: 'block' });

    test('no browser recognition: the recording is transcribed by OpenAI with the saved key', async ({ page }) => {
      const FAKE_KEY = 'sk-test-openai-0000000000000000';
      const { unit, ex, index } = speakItem();
      const requests: Array<{ auth?: string; contentType?: string; body: string }> = [];
      await page.route('https://api.openai.com/v1/audio/transcriptions', async (route: Route) => {
        const req = route.request();
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        requests.push({ auth: req.headers()['authorization'], contentType: req.headers()['content-type'], body: req.postDataBuffer()?.toString('latin1') ?? '' });
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ text: ` ${ex.target} ` }) });
      });
      await stubMedia(page, { recognition: false });
      await onboard(page);

      // The key lives only in this tab's memory, so stay in the app (no reload) after saving it.
      await navTo(page, 'Settings');
      const card = page.getByRole('group', { name: 'OpenAI' });
      await card.getByLabel('API key').fill(FAKE_KEY);
      await card.getByLabel('Passphrase').fill('correct horse battery');
      await card.getByRole('button', { name: 'Save key' }).click();
      await expect(card.getByRole('status')).toHaveText('Key saved and unlocked.');

      await navTo(page, 'Learn');
      await page.getByRole('list', { name: 'A1 units' }).getByRole('link', { name: new RegExp(escapeRegExp(unit.title)) }).click();
      await page.getByRole('navigation', { name: 'Unit steps' }).getByRole('link', { name: 'Übungen' }).click();
      await page.getByRole('button', { name: new RegExp(`^Item ${index + 1}(,|$)`) }).click();
      await expect(page.getByRole('heading', { level: 3, name: ex.prompt })).toBeVisible();

      await expect(page.getByText("Your browser can't recognise speech; after recording, OpenAI can transcribe it with your key.")).toBeVisible();
      await recordOnce(page);
      await expectPlayback(page);
      await page.getByRole('button', { name: 'Transcribe with OpenAI' }).click();

      await expect(heardField(page)).toHaveValue(ex.target);
      await expect(page.getByRole('status').filter({ hasText: 'Transcribed by OpenAI' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Transcribe with OpenAI' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Check', exact: true }).click();
      await expect(result(page)).toContainText('Richtig!');

      expect(requests).toHaveLength(1);
      expect(requests[0]!.auth).toBe(`Bearer ${FAKE_KEY}`);
      expect(requests[0]!.contentType).toMatch(/^multipart\/form-data/);
      expect(requests[0]!.body).toContain('name="file"; filename="audio.webm"');
      expect(requests[0]!.body).toContain('gpt-4o-transcribe');
      expect((await storedAttempts(page)).filter((a) => a.exerciseId === ex.id)).toMatchObject([{ skill: 'speaking', score: 1 }]);
    });
  });
});

test.describe('microphone blocked', () => {
  test('getUserMedia NotAllowedError shows the platform fix steps and self-rating still works', async ({ page }) => {
    await stubMedia(page, { recognition: false, getUserMediaError: 'NotAllowedError' });
    const { unit, ex } = speakItem();
    await onboard(page);
    await openItem(page, unit, ex);
    const ua = await page.evaluate(() => navigator.userAgent);
    await recorder(page).getByRole('button', { name: 'Record', exact: true }).click();

    const alert = recorder(page).getByRole('alert');
    await expect(alert).toContainText('Microphone access is blocked for this site.');
    await expect(alert).toContainText('To turn it on:');
    await expect(alert.getByRole('listitem')).toHaveText(micFixSteps(detectPlatform(ua)));
    await expect(alert).toContainText('You can still listen and rate yourself.');
    await expect(recorder(page).getByRole('button', { name: 'Record', exact: true })).toBeEnabled();

    await page.getByRole('group', { name: 'Rate yourself' }).getByRole('button', { name: 'Okay' }).click();
    await expect(page.getByText('You rated this: Okay.')).toBeVisible();
  });

  test('permission already denied: the fix steps show before recording', async ({ page }) => {
    await stubMedia(page, { recognition: false, micPermission: 'denied' });
    const { unit, ex } = speakItem();
    await onboard(page);
    await openItem(page, unit, ex);
    await expect(recorder(page).getByRole('alert')).toContainText('Microphone access is blocked for this site.');
    await expect(recorder(page).getByRole('alert').getByRole('listitem').first()).toBeVisible();
  });

  test('prompt state: the learner is told the browser will ask', async ({ page }) => {
    await stubMedia(page, { recognition: false, micPermission: 'prompt' });
    const { unit, ex } = speakItem();
    await onboard(page);
    await openItem(page, unit, ex);
    await expect(recorder(page)).toContainText('Your browser will ask for the microphone the first time. Recordings stay on this device.');
    await expect(recorder(page).getByRole('alert')).toHaveCount(0);
  });
});

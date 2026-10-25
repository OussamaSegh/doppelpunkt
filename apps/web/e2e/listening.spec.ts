// Listening items in the unit player: the transcript is played (TTS for Standard German), never shown
// before answering, and revealed with the feedback. Swiss German without a recording is read instead.
import type { Exercise } from '@doppelpunkt/content-schema';
import { a1Pack, expect, onboard, openItem, result, test } from './fixtures';
import { stubMedia, ttsCalls } from './media';

const withTranscript = (pred: (e: Exercise) => boolean) => {
  for (const unit of a1Pack().units) {
    const ex = unit.exercises.find((e) => e.type === 'mcq' && e.skill === 'listening' && !!e.transcript && pred(e));
    if (ex) return { unit, ex: ex as Extract<Exercise, { type: 'mcq' }> };
  }
  throw new Error('no listening mcq with a transcript');
};
const spokenLine = (t: string) => t.split('\n')[0]!.replace(/^[^:]{1,25}:\s*/, '').trim();

test.describe('listening items', () => {
  test('Standard German: Play reads the transcript aloud; it is shown only after Check', async ({ page }) => {
    const { unit, ex } = withTranscript((e) => e.variety === 'de' || e.variety === 'ch-std');
    await stubMedia(page);
    await onboard(page);
    await openItem(page, unit, ex);
    const card = page.getByRole('article');
    await expect(card.getByText(spokenLine(ex.transcript!), { exact: false })).toHaveCount(0);
    await expect(card).toContainText('The transcript is shown after you answer.');
    await card.getByRole('button', { name: 'Play the recording', exact: true }).click();
    await expect.poll(async () => (await ttsCalls(page)).length).toBe(1);
    const [call] = await ttsCalls(page);
    expect(call!.text).toContain(spokenLine(ex.transcript!));
    expect(call!.lang).toBe(ex.variety === 'ch-std' ? 'de-CH' : 'de-DE');
    await card.getByRole('button', { name: 'Play the recording slower' }).click();
    await expect.poll(async () => (await ttsCalls(page)).map((c) => c.rate)).toEqual([1, 0.75]);

    await card.getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: ex.options[ex.answer]!, exact: true }).click();
    await card.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    await expect(result(page)).toContainText('What you heard');
    await expect(result(page)).toContainText(spokenLine(ex.transcript!));
  });

  test('Zurich German without a recording: "No recording yet — read instead", no TTS', async ({ page }) => {
    const { unit, ex } = withTranscript((e) => e.variety === 'gsw-zh');
    await stubMedia(page);
    await onboard(page);
    await openItem(page, unit, ex);
    const card = page.getByRole('article').filter({ has: page.getByRole('heading', { level: 3, name: ex.prompt }) });
    await expect(card).toContainText('No recording yet — read instead');
    await expect(card).toContainText(spokenLine(ex.transcript!));
    await expect(card.getByRole('button', { name: /^Play/ })).toHaveCount(0);
    expect(await ttsCalls(page)).toEqual([]);
  });
});

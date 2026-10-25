import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { PronunciationDrill } from '@doppelpunkt/content-schema';
import { discriminationQuiz } from '../src/lib/pronunciation';
import { expect, navTo, onboard, test } from './fixtures';
import { storedAttempts, stubMedia, ttsCalls } from './media';

let cached: PronunciationDrill[] | undefined;
/** The drills exactly as the app serves them (from the production build). */
function drills(): PronunciationDrill[] {
  cached ??= (JSON.parse(readFileSync(fileURLToPath(new URL('../dist/packs/pronunciation.json', import.meta.url)), 'utf8')) as { drills: PronunciationDrill[] })
    .drills;
  return cached;
}
const drill = (id: string) => {
  const d = drills().find((x) => x.id === id);
  if (!d) throw new Error(`drill ${id} missing from the pack`);
  return d;
};
/** A Standard German drill with minimal pairs (TTS plays them) and a Swiss one without recordings. */
const deDrill = () => drills().find((d) => d.variety === 'de' && d.pairs.length >= 2)!;
const swissDrill = () => drills().find((d) => (d.variety === 'gsw-zh' || d.variety === 'gsw-be') && d.pairs.every((p) => p.every((s) => !s.audio)))!;

/** Desktop: the "Reference" sidebar; phones: the card on Learn (the tab bar stays at five). */
async function openPronunciation(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Reference' });
  if (await sidebar.isVisible()) await sidebar.getByRole('link', { name: 'Pronunciation' }).click();
  else await page.getByRole('link', { name: /Pronunciation drills/ }).click();
  await expect(page).toHaveURL(/\/pronunciation$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pronunciation' })).toBeVisible();
}

const drillList = (page: Page) => page.getByRole('list', { name: 'Pronunciation drills' });

test.describe('pronunciation drills', () => {
  test.beforeEach(async ({ page }) => {
    await stubMedia(page);
  });

  test('the list shows every drill and opens one from the sidebar or the Learn card', async ({ page, isMobile }) => {
    expect(drills()).toHaveLength(16);
    await onboard(page);
    // Phones have no sidebar; desktop has no need for the card but shows it too.
    await expect(page.getByRole('navigation', { name: 'Reference' })).toBeVisible({ visible: !isMobile });
    await openPronunciation(page);

    const items = drillList(page).getByRole('listitem');
    await expect(items).toHaveCount(drills().length);
    for (const [i, d] of drills().entries()) {
      await expect(items.nth(i)).toContainText(d.title);
      await expect(items.nth(i)).toContainText(`${d.pairs.length} pairs · ${d.words.length} words`);
    }

    const d = deDrill();
    await drillList(page).getByRole('link', { name: new RegExp(d.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page).toHaveURL(new RegExp(`/pronunciation/${d.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(d.title);
    await page.getByRole('link', { name: '← All drills' }).click();
    await expect(drillList(page)).toBeVisible();
  });

  test('drill view: explanation, minimal pairs, quiz and repeat-after-me', async ({ page }) => {
    const d = drill('ue-u-i');
    await onboard(page);
    await page.goto(`/pronunciation/${d.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(d.title);
    await expect(page.getByRole('heading', { name: 'How to say it' })).toBeVisible();
    for (const t of d.tips) await expect(page.getByText(t, { exact: true })).toBeVisible();

    const pairs = page.getByRole('list', { name: 'Minimal pairs' }).getByRole('listitem');
    await expect(pairs).toHaveCount(d.pairs.length);
    await expect(pairs.first()).toContainText(d.pairs[0]![0].text);
    await expect(pairs.first()).toContainText(d.pairs[0]![1].text);
    await expect(page.getByRole('heading', { name: 'Which did you hear?' })).toBeVisible();

    const repeat = d.pairs.length * 2 + d.words.length + d.sentences.length;
    const stepper = page.locator('#repeat');
    await expect(stepper.getByRole('heading', { name: 'Repeat after me' })).toBeVisible();
    await expect(stepper.getByText(`1 of ${repeat}`)).toBeVisible();
    await expect(stepper.getByRole('button', { name: '← Previous' })).toBeDisabled();
    await stepper.getByRole('button', { name: 'Next →' }).click();
    await expect(stepper.getByText(`2 of ${repeat}`)).toBeVisible();
    await expect(stepper).toContainText(d.pairs[0]![1].text);

    // "Practise" on a word jumps the stepper to that word.
    const word = d.words[1]!;
    await page.getByRole('button', { name: `Practise: ${word.text}`, exact: true }).click();
    await expect(stepper.getByText(`${d.pairs.length * 2 + 2} of ${repeat}`)).toBeVisible();
    await expect(stepper).toContainText(word.en);
    // Shadowing controls on drills: speeds 0.75×–1.25×.
    await expect(stepper.getByRole('radiogroup', { name: 'Speed' }).getByRole('radio')).toHaveText(['0.75×', '1×', '1.25×']);
  });

  test('"Which did you hear?" records right and wrong answers as listening', async ({ page }) => {
    const d = deDrill();
    const questions = discriminationQuiz(d, `${d.id}:0`);
    await onboard(page);
    await page.goto(`/pronunciation/${d.id}`);
    const quiz = page.getByRole('region', { name: 'Which did you hear?' });
    await expect(quiz).toContainText(`Question 1 of ${questions.length}`);

    // Right answer.
    await quiz.getByRole('button', { name: 'Play the word' }).click();
    await expect.poll(async () => (await ttsCalls(page)).map((c) => c.text)).toContain(questions[0]!.play.text);
    const options = quiz.getByRole('group', { name: 'What did you hear?' });
    await options.getByRole('button', { name: questions[0]!.options[questions[0]!.answer]!.text, exact: true }).click();
    await expect(quiz).toContainText('Richtig!');
    await expect(options.getByRole('button').first()).toBeDisabled();
    await quiz.getByRole('button', { name: 'Next question' }).click();

    // Wrong answer: the solution is shown.
    const q2 = questions[1]!;
    await expect(quiz).toContainText(`Question 2 of ${questions.length}`);
    await options.getByRole('button', { name: q2.options[1 - q2.answer]!.text, exact: true }).click();
    await expect(quiz).toContainText(`Not quite: it was “${q2.play.text}” (${q2.play.en}).`);

    await expect
      .poll(async () => (await storedAttempts(page)).filter((a) => a.unitId === `pron-${d.id}`).map((a) => [a.skill, a.score]))
      .toEqual([
        ['listening', 1],
        ['listening', 0],
      ]);
    // The list counts speaking tries only.
    await page.getByRole('link', { name: '← All drills' }).click();
    await expect(drillList(page).getByRole('listitem').filter({ hasText: d.title })).not.toContainText('tries');
  });

  test('repeat after me: self-rating is stored as speaking and shows on the list and the radar', async ({ page }) => {
    const d = deDrill();
    await onboard(page);
    await page.goto(`/pronunciation/${d.id}`);
    const stepper = page.locator('#repeat');
    await expect(stepper.getByRole('button', { name: 'Record' })).toBeVisible();
    await expect(stepper.getByText('Not recorded yet.')).toBeVisible();
    const rate = stepper.getByRole('group', { name: 'Rate yourself' });
    await expect(rate.getByRole('button')).toHaveText(['Needs work', 'Good']);
    await rate.getByRole('button', { name: 'Good' }).click();
    await expect(stepper.getByText('You rated this: Good.')).toBeVisible();
    await expect(stepper.getByRole('status').filter({ hasText: 'Self-rated' })).toBeVisible();
    await stepper.getByRole('button', { name: 'Try again' }).click();
    await expect(rate).toBeVisible();

    const rows = (await storedAttempts(page)).filter((a) => a.unitId === `pron-${d.id}`);
    expect(rows).toMatchObject([{ skill: 'speaking', score: 1, variety: d.variety, exerciseId: `pron-${d.id}-pair-0` }]);

    await page.getByRole('link', { name: '← All drills' }).click();
    await expect(drillList(page).getByRole('listitem').filter({ hasText: d.title })).toContainText('1 try, 100% avg');

    await navTo(page, 'Progress');
    await expect(page.getByRole('img', { name: 'Skill radar chart' })).toBeVisible();
    const speaking = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Speaking', exact: true }) });
    await expect(speaking.getByRole('cell').nth(1)).not.toHaveText('–');
    await expect(speaking.getByRole('cell').nth(2)).toContainText('(1)');
  });

  test('Swiss drill without recordings says "No recording yet" and never uses a TTS voice', async ({ page }) => {
    const d = swissDrill();
    expect(d, 'a Swiss German drill without recordings').toBeTruthy();
    await onboard(page);
    await page.goto(`/pronunciation/${d.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(d.title);

    await expect(page.getByRole('region', { name: 'Which did you hear?' })).toContainText('No recording yet: this quiz needs native recordings of every pair.');
    await expect(page.getByRole('button', { name: 'Play the word' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Minimal pairs' }).getByText('No recording yet')).toHaveCount(d.pairs.length * 2);
    await expect(page.getByRole('button', { name: /^Listen/ })).toHaveCount(0);

    const stepper = page.locator('#repeat');
    await expect(stepper.getByText('No recording yet')).toBeVisible();
    await expect(stepper.getByRole('button', { name: 'Listen, then speak' })).toHaveCount(0);
    await expect(stepper.getByRole('button', { name: /Play native/ })).toHaveCount(0);
    await stepper.getByRole('button', { name: 'Next →' }).click();
    await stepper.getByRole('group', { name: 'Rate yourself' }).getByRole('button', { name: 'Needs work' }).click();
    await expect(stepper.getByText('You rated this: Needs work.')).toBeVisible();

    expect(await ttsCalls(page)).toEqual([]);
  });

  test('unknown drill shows a not-found state', async ({ page }) => {
    await onboard(page);
    await page.goto('/pronunciation/no-such-drill');
    await expect(page.getByRole('heading', { name: 'Drill not found' })).toBeVisible();
    await page.getByRole('link', { name: 'All drills' }).click();
    await expect(drillList(page)).toBeVisible();
  });
});

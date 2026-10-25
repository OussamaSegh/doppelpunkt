import type { Exercise } from '@doppelpunkt/content-schema';
import { wordsInExercises } from '../src/lib/practice';
import { answerCorrectly, answerMcqWrong, expect, firstOfType, navTo, onboard, openItem, pressOnPage, result, test, uebungen, unit1 } from './fixtures';

// v0.2 exercise player polish: umlaut bar, keyboard, "Almost!", retry, haptics, session summary.

const bar = (page: import('@playwright/test').Page) => page.getByRole('group', { name: 'Insert special characters' });

test.describe('umlaut bar', () => {
  test('inserts ä ö ü ß at the caret of a gap', async ({ page }) => {
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'gap');
    await onboard(page);
    await openItem(page, unit, ex);
    await expect(bar(page).getByRole('button')).toHaveText(['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü']);
    // Screen readers can tell the capitals apart.
    await expect(bar(page).getByRole('button', { name: 'Insert capital Ü', exact: true })).toHaveText('Ü');

    const gap = page.getByRole('textbox', { name: 'Gap 1', exact: true });
    await gap.fill('Grsse');
    // Put the caret after "Gr" and insert ü, then ß replaces the selected "ss".
    await gap.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 2));
    await bar(page).getByRole('button', { name: 'Insert ü', exact: true }).click();
    await expect(gap).toHaveValue('Grüsse');
    await expect(gap).toBeFocused();
    await gap.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 5));
    await bar(page).getByRole('button', { name: 'Insert ß', exact: true }).click();
    await expect(gap).toHaveValue('Grüße');

    // The bar goes away once the answer is checked.
    for (const i of ex.answers.keys()) if (i > 0) await page.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill('x');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test('is shown under every free-text input in unit 1', async ({ page }) => {
    const unit = unit1();
    const textTypes: Array<[Exercise['type'], string]> = [
      ['dictation', 'What you heard'],
      ['translate', 'Your translation'],
      ['transform', 'Rewrite in'],
    ];
    await onboard(page);
    for (const [type, label] of textTypes) {
      const ex = unit.exercises.find((e) => e.type === type);
      if (!ex) continue;
      await openItem(page, unit, ex);
      const box = page.getByRole('textbox', { name: new RegExp(`^${label}`) });
      await box.fill('Mdchen');
      await box.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => el.setSelectionRange(1, 1));
      await bar(page).getByRole('button', { name: 'Insert ä', exact: true }).click();
      await expect(box, `${type} input`).toHaveValue('Mädchen');
    }
    // Open writing task (textarea) too.
    const write = unit.exercises.find((e) => e.type === 'write');
    if (write) {
      await openItem(page, unit, write);
      await expect(page.getByRole('article').getByRole('group', { name: 'Insert special characters' })).toBeVisible();
    }
  });
});

test.describe('keyboard', () => {
  test('number keys pick a multiple-choice option, Enter checks, Enter moves to the next item', async ({ page, isMobile }) => {
    const unit = unit1();
    const list = uebungen(unit);
    const { ex, index } = firstOfType(list, 'mcq');
    await onboard(page);
    await openItem(page, unit, ex);

    const radios = page.getByRole('radiogroup', { name: 'Options' }).getByRole('radio');
    const shown = await radios.locator('span[lang]').allTextContents();
    const pos = shown.indexOf(ex.options[ex.answer]!);
    expect(pos).toBeGreaterThanOrEqual(0);
    await expect(radios.nth(pos)).toHaveAttribute('aria-keyshortcuts', String(pos + 1));

    // A wrong digit first, then the right one: the last key wins.
    await pressOnPage(page, String(((pos + 1) % shown.length) + 1));
    await expect(radios.nth((pos + 1) % shown.length)).toHaveAttribute('aria-checked', 'true');
    await pressOnPage(page, String(pos + 1));
    await expect(radios.nth(pos)).toHaveAttribute('aria-checked', 'true');

    await pressOnPage(page, 'Enter');
    await expect(result(page)).toContainText('Richtig!');
    // The keyboard hint is for wider screens only.
    if (!isMobile) await expect(page.getByText(/Press\s*Enter\s*for the next item/)).toBeVisible();
    await pressOnPage(page, 'Enter');
    await expect(page.getByRole('heading', { level: 3, name: list[index + 1]!.prompt })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^Item ${index + 2}(,|$)`) })).toHaveAttribute('aria-current', 'step');
  });

  test('Enter in a gap submits the answer', async ({ page }) => {
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'gap');
    await onboard(page);
    await openItem(page, unit, ex);
    for (const [i, accepted] of ex.answers.entries()) await page.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill(accepted[0]!);
    await page.getByRole('textbox', { name: `Gap ${ex.answers.length}`, exact: true }).press('Enter');
    await expect(result(page)).toContainText('Richtig!');
  });
});

/** A gap item with an answer long enough for a one-letter typo (the other gaps are answered right). */
function almostCandidate() {
  const unit = unit1();
  const long = (a: string) => /^\p{L}{4,}$/u.test(a);
  const ex = uebungen(unit).find((e): e is Extract<Exercise, { type: 'gap' }> => e.type === 'gap' && e.answers.some((a) => long(a[0]!)));
  if (!ex) throw new Error('unit 1 has no gap item with a 4+ letter answer');
  const gap = ex.answers.findIndex((a) => long(a[0]!));
  const word = ex.answers[gap]![0]!;
  // Replace the third letter with one that isn't in the word.
  const typo = word.slice(0, 2) + (word[2]!.toLowerCase() === 'x' ? 'q' : 'x') + word.slice(3);
  return { unit, ex, gap, word, typo };
}

test.describe('feedback states and retry', () => {
  test('"Almost!" for a one-letter slip, with Try again; a right answer has no Try again', async ({ page }) => {
    const { unit, ex, gap, word, typo } = almostCandidate();
    const box = (i: number) => page.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true });
    await onboard(page);
    await openItem(page, unit, ex);
    for (const [i, a] of ex.answers.entries()) await box(i).fill(i === gap ? typo : a[0]!);
    await page.getByRole('button', { name: 'Check' }).click();

    await expect(result(page)).toHaveAttribute('data-tone', 'almost');
    await expect(result(page)).toContainText('Almost!');
    await expect(result(page)).toContainText('So close: one small slip.');
    await expect(result(page)).toContainText(`should be “${word}”`);
    await expect(result(page)).toContainText('Solution');
    await expect(result(page)).toContainText(ex.explanation);

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(result(page)).toHaveCount(0);
    await expect(box(gap)).toHaveValue('');
    for (const [i, a] of ex.answers.entries()) await box(i).fill(a[0]!);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toHaveAttribute('data-tone', 'right');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('a wrong answer has tone "wrong" and offers Try again', async ({ page }) => {
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'mcq');
    await onboard(page);
    await openItem(page, unit, ex);
    await answerMcqWrong(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toHaveAttribute('data-tone', 'wrong');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('vibration', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const calls: unknown[] = [];
      (window as unknown as { __vibrations: unknown[] }).__vibrations = calls;
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => (calls.push(p), true) });
    });
  });
  const vibrations = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);

  test('vibrates on right and wrong answers, and not when switched off in Settings', async ({ page }) => {
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'mcq');
    await onboard(page);
    await openItem(page, unit, ex);
    await answerMcqWrong(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toBeVisible();
    await page.getByRole('button', { name: 'Try again' }).click();
    await answerCorrectly(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    expect(await vibrations(page)).toEqual([[70, 50, 70], [25]]);

    await navTo(page, 'Settings');
    const toggle = page.getByRole('checkbox', { name: /Vibrate on right and wrong answers/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    await openItem(page, unit, ex);
    await answerCorrectly(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    expect(await vibrations(page)).toEqual([]);
  });

  test('no vibration when the system asks for reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const unit = unit1();
    const { ex } = firstOfType(uebungen(unit), 'mcq');
    await onboard(page);
    await openItem(page, unit, ex);
    await answerCorrectly(page, ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    expect(await vibrations(page)).toEqual([]);
  });
});

test.describe('session summary', () => {
  test('after the last item: score, mistakes with "Practise item n again", add missed words to review', async ({ page }) => {
    const unit = unit1();
    const list = uebungen(unit);
    // Answer two multiple-choice items: the first wrong, the second right, then jump to the end.
    const mcqs = list.map((ex, i) => ({ ex, i })).filter((x): x is { ex: Extract<Exercise, { type: 'mcq' }>; i: number } => x.ex.type === 'mcq');
    const missed = mcqs.find(({ ex }) => wordsInExercises(unit, [ex]).length > 0) ?? mcqs[0]!;
    const right = mcqs.find((x) => x !== missed)!;
    const words = wordsInExercises(unit, [missed.ex]);

    await onboard(page);
    await page.goto(`/unit/${unit.id}/uebungen`);
    const strip = page.getByRole('list', { name: `Exercises: ${list.length} items` });
    await strip.getByRole('button', { name: new RegExp(`^Item ${missed.i + 1}(,|$)`) }).click();
    await answerMcqWrong(page, missed.ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Not quite');
    // A retry doesn't change the session score (first attempts count).
    await page.getByRole('button', { name: 'Try again' }).click();
    await answerCorrectly(page, missed.ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');

    await strip.getByRole('button', { name: new RegExp(`^Item ${right.i + 1}(,|$)`) }).click();
    await answerCorrectly(page, right.ex);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');

    // The last item shows Finish instead of Next.
    await strip.getByRole('button', { name: new RegExp(`^Item ${list.length}(,|$)`) }).click();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish' }).click();

    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary).toContainText(`2 of ${list.length} items answered`);
    await expect(summary).toContainText('50%');
    await expect(summary).toContainText('first attempts only');
    await expect(summary).toContainText('1 / 2');
    await expect(summary.getByRole('list', { name: 'Score by skill' }).getByRole('listitem')).not.toHaveCount(0);
    const mistakes = summary.getByRole('list', { name: 'Mistakes to review' }).getByRole('listitem');
    await expect(mistakes).toHaveCount(1);
    await expect(mistakes.first()).toContainText(missed.ex.prompt);

    if (words.length) {
      await summary.getByRole('button', { name: 'Add missed words to review' }).click();
      await expect(summary.getByRole('status')).toHaveText(`Added ${words.length} word${words.length === 1 ? '' : 's'} to your review deck.`);
      await expect(summary.getByRole('button', { name: 'Add missed words to review' })).toBeDisabled();
    }

    // Practise the missed item again: ?item=<id> opens it.
    await summary.getByRole('link', { name: `Practise item ${missed.i + 1} again` }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${unit.id}/uebungen\\?item=${missed.ex.id}$`));
    await expect(page.getByRole('heading', { level: 3, name: missed.ex.prompt })).toBeVisible();
    await expect(strip.getByRole('button', { name: new RegExp(`^Item ${missed.i + 1}(,|$)`) })).toHaveAttribute('aria-current', 'step');

    if (words.length) {
      await navTo(page, 'Review');
      await expect(page.getByText(/^\d+ due$/)).toHaveText(`${words.length} due`);
    }
  });

  test('Enter on the last answered item opens the summary; "Practise this set again" restarts', async ({ page }) => {
    const unit = unit1();
    const list = uebungen(unit);
    const lastEx = list[list.length - 1]!;
    await onboard(page);
    await openItem(page, unit, lastEx);
    // Skip it: the summary says nothing was answered.
    await page.getByRole('button', { name: 'Finish' }).click();
    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary).toContainText(`0 of ${list.length} items answered`);
    await expect(summary).toContainText("You haven't answered any items in this set yet.");
    await summary.getByRole('button', { name: 'Practise this set again' }).click();
    await expect(page.getByRole('heading', { level: 3, name: list[0]!.prompt })).toBeVisible();

    // A closed last item answered with the keyboard → Enter → summary.
    const closed = [...list].reverse().find((e) => e.type === 'mcq' || e.type === 'gap' || e.type === 'order' || e.type === 'match');
    if (closed && closed === lastEx) {
      await openItem(page, unit, lastEx);
      await answerCorrectly(page, lastEx);
      await pressOnPage(page, 'Enter');
      await expect(result(page)).toContainText('Richtig!');
      await pressOnPage(page, 'Enter');
      await expect(page.getByRole('region', { name: 'Session summary' })).toContainText(`1 of ${list.length} items answered`);
    }
  });
});

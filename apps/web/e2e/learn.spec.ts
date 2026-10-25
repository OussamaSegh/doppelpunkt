import { a1Pack, allPacks, escapeRegExp, expect, firstOfType, onboard, orderTokens, result, test, uebungen, unit1 } from './fixtures';

test.describe('onboarding and learning', () => {
  test('onboarding leads to Learn with the A1 units', async ({ page }) => {
    await onboard(page);
    const units = page.getByRole('list', { name: 'A1 units' }).getByRole('listitem');
    await expect(units).toHaveCount(a1Pack().units.length);
    const first = unit1();
    await expect(units.first()).toContainText(first.title);
    await expect(units.first()).toContainText('Start here');
    await expect(page.getByRole('navigation', { name: 'Levels' }).getByRole('link', { name: 'A1' })).toHaveAttribute('aria-current', 'page');
  });

  test('v0.3 units 7–9 are listed on Learn and open', async ({ page }) => {
    const later = a1Pack().units.filter((u) => u.number >= 7 && u.number <= 9);
    expect(later.map((u) => u.number)).toEqual([7, 8, 9]);
    await onboard(page);
    const list = page.getByRole('list', { name: 'A1 units' });
    for (const u of later) await expect(list.getByRole('listitem').nth(u.number - 1)).toContainText(`Unit ${u.number}`);
    for (const u of later) await expect(list.getByRole('listitem').nth(u.number - 1)).toContainText(u.title);
    const u9 = later.at(-1)!;
    await list.getByRole('link', { name: new RegExp(escapeRegExp(u9.title)) }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${u9.id}/einstieg$`));
    await expect(page.getByRole('heading', { level: 1, name: u9.title })).toBeVisible();
  });

  test('v0.4 units 10–12 are listed on Learn and open', async ({ page }) => {
    const later = a1Pack().units.filter((u) => u.number >= 10 && u.number <= 12);
    expect(later.map((u) => u.number)).toEqual([10, 11, 12]);
    await onboard(page);
    const list = page.getByRole('list', { name: 'A1 units' });
    await expect(list.getByRole('listitem')).toHaveCount(12);
    for (const u of later) {
      await expect(list.getByRole('listitem').nth(u.number - 1)).toContainText(`Unit ${u.number}`);
      await expect(list.getByRole('listitem').nth(u.number - 1)).toContainText(u.title);
    }
    const u12 = later.at(-1)!;
    await list.getByRole('link', { name: new RegExp(escapeRegExp(u12.title)) }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${u12.id}/einstieg$`));
    await expect(page.getByRole('heading', { level: 1, name: u12.title })).toBeVisible();
  });

  test('v0.5 A2 preview: "Preview — n of 12 units", the A2 units open; A1 has no preview note', async ({ page }) => {
    const a2 = allPacks().find((p) => p.level === 'A2');
    expect(a2, 'the build ships an A2 pack').toBeTruthy();
    expect(a2!.units.length).toBeLessThan(12);
    await onboard(page);
    await expect(page.getByText(/Preview —/)).toHaveCount(0);
    const levels = page.getByRole('navigation', { name: 'Levels' });
    await levels.getByRole('link', { name: 'A2 preview' }).click();
    await expect(page).toHaveURL(/\/learn\/A2$/);
    await expect(page.getByRole('note')).toHaveText(`Preview — ${a2!.units.length} of 12 units. More A2 units are on the way; these are ready to use.`);
    const list = page.getByRole('list', { name: 'A2 units' });
    await expect(list.getByRole('listitem')).toHaveCount(a2!.units.length);
    const first = a2!.units[0]!;
    await expect(list.getByRole('listitem').first()).toContainText(`A2 · Unit ${first.number}`);
    await list.getByRole('link', { name: new RegExp(escapeRegExp(first.title)) }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${first.id}/einstieg$`));
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();
  });

  test('a learner can walk through every step of unit 1', async ({ page }) => {
    const unit = unit1();
    await onboard(page);
    await page.getByRole('link', { name: new RegExp(escapeRegExp(unit.title)) }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${unit.id}/einstieg$`));
    await expect(page.getByRole('heading', { level: 1, name: unit.title })).toBeVisible();

    const steps: Array<[label: string, region: string]> = [
      ['Einstieg', 'Intro'],
      ['Wortschatz', 'Vocabulary'],
      ['Grammatik', 'Grammar'],
      ...(unit.reading ? ([['Lesen', 'Reading']] as Array<[string, string]>) : []),
      ['Übungen', 'Exercises'],
      ['Schwiiz', 'Swiss lane'],
      ['Check', 'Self-check'],
    ];
    const stepNav = page.getByRole('navigation', { name: 'Unit steps' });
    await expect(stepNav.getByRole('link')).toHaveCount(steps.length);

    for (const [i, [label, region]] of steps.entries()) {
      await expect(page.getByRole('region', { name: region })).toBeVisible();
      await expect(stepNav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
      const next = steps[i + 1];
      if (next) await page.getByRole('link', { name: `Next: ${next[0]} →` }).click();
    }

    // Spot-check content on the way back.
    await stepNav.getByRole('link', { name: 'Wortschatz' }).click();
    await expect(page.getByText(`${unit.vocab.length} words`)).toBeVisible();
    await stepNav.getByRole('link', { name: 'Grammatik' }).click();
    await expect(page.getByRole('heading', { level: 2, name: unit.grammar[0]!.title })).toBeVisible();

    // Self-check: tick a can-do and mark the unit done.
    await stepNav.getByRole('link', { name: 'Check' }).click();
    // The checkbox reflects the saved state, so it flips once the write lands.
    await page.getByRole('checkbox', { name: unit.canDo[0]! }).click();
    await expect(page.getByRole('checkbox', { name: unit.canDo[0]! })).toBeChecked();
    await page.getByRole('button', { name: 'Mark unit as done' }).click();
    await expect(page.getByRole('button', { name: 'Mark as not done' })).toBeVisible();
  });

  test('multiple choice: wrong answer shows solution and explanation, right answer is accepted', async ({ page }) => {
    const unit = unit1();
    const { ex, index } = firstOfType(uebungen(unit), 'mcq');
    await onboard(page);
    await page.goto(`/unit/${unit.id}/uebungen`);
    await page.getByRole('button', { name: new RegExp(`^Item ${index + 1}(,|$)`) }).click();
    await expect(page.getByRole('heading', { level: 3, name: ex.prompt })).toBeVisible();

    const options = page.getByRole('radiogroup', { name: 'Options' });
    const correct = ex.options[ex.answer]!;
    const wrong = ex.options.find((_, i) => i !== ex.answer)!;
    const check = page.getByRole('button', { name: 'Check' });
    await expect(check).toBeDisabled();

    await options.getByRole('radio', { name: wrong, exact: true }).click();
    await check.click();
    await expect(result(page)).toContainText('Not quite');
    await expect(result(page)).toContainText('Solution');
    await expect(result(page)).toContainText(correct);
    await expect(result(page)).toContainText(ex.explanation);

    await page.getByRole('button', { name: 'Try again' }).click();
    await page.getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: correct, exact: true }).click();
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    await expect(result(page)).not.toContainText('Solution');
    await expect(result(page)).toContainText(ex.explanation);
    await expect(page.getByRole('button', { name: new RegExp(`^Item ${index + 1}, best 100%`) })).toBeVisible();
  });

  test('gap fill: wrong answer shows solution and explanation, right answer is accepted', async ({ page }) => {
    const unit = unit1();
    const { ex, index } = firstOfType(uebungen(unit), 'gap');
    await onboard(page);
    await page.goto(`/unit/${unit.id}/uebungen`);
    await page.getByRole('button', { name: new RegExp(`^Item ${index + 1}(,|$)`) }).click();
    await expect(page.getByRole('heading', { level: 3, name: ex.prompt })).toBeVisible();

    for (const i of ex.answers.keys()) await page.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill('xyz');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText(/Not quite|Almost/);
    await expect(result(page)).toContainText('Solution');
    await expect(result(page)).toContainText(ex.explanation);

    await page.getByRole('button', { name: 'Try again' }).click();
    for (const [i, accepted] of ex.answers.entries()) {
      await page.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill(accepted[0]!);
    }
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
    await expect(result(page)).toContainText(ex.explanation);
  });

  test('word order: tapping the words builds the sentence', async ({ page }) => {
    const unit = unit1();
    const { ex, index } = firstOfType(uebungen(unit), 'order');
    const solution = orderTokens(ex.tokens, ex.answers[0]!);
    await onboard(page);
    await page.goto(`/unit/${unit.id}/uebungen`);
    await page.getByRole('button', { name: new RegExp(`^Item ${index + 1}(,|$)`) }).click();
    await expect(page.getByRole('heading', { level: 3, name: ex.prompt })).toBeVisible();

    const words = page.getByRole('group', { name: 'Words' });
    const built = page.getByRole('group', { name: 'Your sentence' });
    const tap = (t: string) => words.getByRole('button', { name: t, exact: true }).and(page.locator(':enabled')).first().click();

    // Wrong order first (reverse), then remove a word and start over.
    for (const t of [...solution].reverse()) await tap(t);
    await built.getByRole('button', { name: `Remove ${solution[0]}` }).click();
    await tap(solution[0]!);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText(/Not quite|Almost/);
    // The solution shown is the accepted answer closest to the learner's attempt.
    await expect(result(page)).toContainText(new RegExp(ex.answers.map(escapeRegExp).join('|')));

    await page.getByRole('button', { name: 'Try again' }).click();
    for (const t of solution) await tap(t);
    await expect(built.getByRole('button')).toHaveCount(solution.length);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(result(page)).toContainText('Richtig!');
  });

  test('Swiss lane shows the Zurich German dialogue and exercises with ZH tags', async ({ page }) => {
    const unit = unit1();
    await onboard(page);
    await page.goto(`/unit/${unit.id}/schwiiz`);
    const lane = page.getByRole('region', { name: 'Swiss lane' });
    await expect(lane).toBeVisible();
    await expect(lane.getByRole('heading', { name: 'Good to know in Switzerland' })).toBeVisible();
    const zhLine = unit.swiss.dialogue.find((l) => l.variety === 'gsw-zh');
    if (zhLine) await expect(lane.getByText(zhLine.text, { exact: true }).first()).toBeVisible();

    const zhTags = lane.getByRole('img', { name: 'Zurich German' });
    expect(await zhTags.count()).toBeGreaterThan(1);
    await expect(zhTags.first()).toHaveText('ZH');

    // The first Swiss exercise is in the learner's dialect (Zurich).
    const exercise = lane.getByRole('article');
    await expect(exercise.getByRole('img', { name: 'Zurich German' }).first()).toBeVisible();
  });
});

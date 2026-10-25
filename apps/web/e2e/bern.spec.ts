import { a1Pack, exerciseById, expect, isSwiss, navTo, onboard, shownExerciseId, test, unit1 } from './fixtures';

// A learner who picks Bern in onboarding gets the Bernese (gsw-be) items first in every Swiss lane,
// then the Zurich ones; the dialogue is in Bernese with the Zurich version one tap away.

test.describe('Bern learner', () => {
  test('onboarding with Bern: the Schwiiz lane of unit 1 shows BE items first', async ({ page }) => {
    const unit = unit1();
    const swiss = unit.exercises.filter(isSwiss);
    const be = swiss.filter((e) => e.variety === 'gsw-be');
    expect(be.length, 'unit 1 has Bernese exercises').toBeGreaterThan(0);

    await onboard(page, { dialect: 'Bern' });
    await page.goto(`/unit/${unit.id}/schwiiz`);
    const lane = page.getByRole('region', { name: 'Swiss lane' });
    await expect(lane).toBeVisible();

    // Exercise order: every Bernese item, then the Zurich ones.
    const strip = lane.getByRole('list', { name: `Swiss exercises: ${swiss.length} items` });
    await expect(strip.getByRole('listitem')).toHaveCount(swiss.length);
    const seen: string[] = [];
    for (let i = 0; i < swiss.length; i++) {
      await strip.getByRole('button', { name: new RegExp(`^Item ${i + 1}(,|$)`) }).click();
      seen.push(exerciseById(await shownExerciseId(page)).variety);
    }
    expect(seen).toEqual([...be.map(() => 'gsw-be'), ...swiss.filter((e) => e.variety !== 'gsw-be').map((e) => e.variety)]);

    // The first item carries the BE tag.
    await strip.getByRole('button', { name: /^Item 1(,|$)/ }).click();
    const card = lane.getByRole('article');
    await expect(card.getByRole('img', { name: 'Bernese German' }).first()).toHaveText('BE');

    // Dialogue in Bernese; the Zurich version is behind a toggle. No fallback note.
    const beLine = unit.swiss.dialogue.find((l) => l.variety === 'gsw-be');
    const zhLine = unit.swiss.dialogue.find((l) => l.variety === 'gsw-zh');
    if (beLine) await expect(lane.getByText(beLine.text, { exact: true }).first()).toBeVisible();
    await expect(lane.getByRole('note')).toHaveCount(0);
    if (zhLine) {
      await expect(lane.getByText(zhLine.text, { exact: true })).toHaveCount(0);
      const toggle = lane.getByRole('button', { name: 'Show the Zurich German version' });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(lane.getByRole('button', { name: 'Hide the Zurich German version' })).toHaveAttribute('aria-expanded', 'true');
      await expect(lane.getByText(zhLine.text, { exact: true }).first()).toBeVisible();
    }
  });

  test('every A1 unit leads with its Bernese items for a Bern learner', async ({ page }) => {
    await onboard(page, { dialect: 'Bern' });
    for (const unit of a1Pack().units) {
      const swiss = unit.exercises.filter(isSwiss);
      if (!swiss.length) continue;
      const hasBe = swiss.some((e) => e.variety === 'gsw-be');
      await page.goto(`/unit/${unit.id}/schwiiz`);
      const lane = page.getByRole('region', { name: 'Swiss lane' });
      await expect(lane.getByRole('article')).toBeVisible();
      const first = exerciseById(await shownExerciseId(page));
      expect(first.variety, `${unit.id}: first Swiss item`).toBe(hasBe ? 'gsw-be' : 'gsw-zh');
      if (!hasBe) await expect(lane.getByRole('note')).toContainText('Bernese German');
    }
  });

  test('a Zurich learner gets ZH first; switching to Bern in Settings puts BE first', async ({ page }) => {
    const unit = unit1();
    await onboard(page);
    await page.goto(`/unit/${unit.id}/schwiiz`);
    const lane = page.getByRole('region', { name: 'Swiss lane' });
    await expect(lane.getByRole('article')).toBeVisible();
    expect(exerciseById(await shownExerciseId(page)).variety).toBe('gsw-zh');
    if (unit.swiss.dialogue.some((l) => l.variety === 'gsw-be')) {
      await lane.getByRole('button', { name: 'Show the Bernese German version' }).click();
      await expect(lane.getByRole('img', { name: 'Bernese German' }).first()).toBeVisible();
    }

    await navTo(page, 'Settings');
    const select = page.getByRole('combobox', { name: 'Swiss German dialect' });
    await select.selectOption({ label: 'Bern (Bärndütsch)' });
    await expect(select).toHaveValue('gsw-be');
    await page.goto(`/unit/${unit.id}/schwiiz`);
    await expect(lane.getByRole('article')).toBeVisible();
    expect(exerciseById(await shownExerciseId(page)).variety).toBe('gsw-be');
  });

  test('units not yet signed off show the "Not yet reviewed by a native speaker" note', async ({ page }) => {
    const unit = unit1();
    await onboard(page);
    await page.goto(`/unit/${unit.id}`);
    const note = page.getByText(/Not yet reviewed by a native speaker|Checked by native speakers/);
    await expect(note).toBeVisible();
    const signedOff = !!unit.review?.de && !!unit.review?.ch;
    await expect(note).toContainText(signedOff ? 'Checked by native speakers' : 'Not yet reviewed by a native speaker');
  });
});

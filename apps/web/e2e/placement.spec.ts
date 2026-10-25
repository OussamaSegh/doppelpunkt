import { a1Pack, answerCorrectly, answerMcqWrong, exerciseById, expect, navTo, onboard, pressOnPage, shownExerciseId, test } from './fixtures';

// The placement test runs on the real A1 pack. Only A1 is installed, so there is one section and the
// adaptive stop between levels cannot trigger here (it is covered by src/screens/Placement.test.tsx).

test.describe('placement test', () => {
  test('intro: sections, length and the rules are explained before starting', async ({ page }) => {
    await onboard(page, { start: 'placement' });
    const intro = page.getByRole('region', { name: 'Placement test' });
    await expect(intro.getByRole('heading', { level: 1, name: 'Placement test' })).toBeVisible();
    await expect(intro).toContainText(/\d+ questions in 1 section \(A1\), about \d+ minutes\./);
    await expect(intro).toContainText('If a level is clearly too hard, the test ends there.');
    await expect(intro).toContainText("You won't see the answers during the test");
    await page.getByRole('button', { name: 'Start the test' }).click();

    const sections = page.getByRole('list', { name: 'Sections' });
    await expect(sections.getByRole('listitem')).toHaveText(['A1']);
    await expect(sections.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText(/^Section 1 of 1: A1 · question 1 of \d+$/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Placement progress' })).toBeVisible();
    // Next stays disabled until the question is answered.
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    // Placement items are Standard German (or Swiss Standard German) closed exercises.
    const ex = exerciseById(await shownExerciseId(page));
    expect(['de', 'ch-std']).toContain(ex.variety);
    expect(['mcq', 'gap', 'order', 'match']).toContain(ex.type);
  });

  test('stopping early with wrong answers places the learner at A1 unit 1', async ({ page }) => {
    await onboard(page, { start: 'placement' });
    await page.getByRole('button', { name: 'Start the test' }).click();

    // Answer the first two questions wrong (or skip ahead to the first mcq), then stop.
    let answered = 0;
    for (let i = 0; i < 10 && answered < 2; i++) {
      const ex = exerciseById(await shownExerciseId(page));
      if (ex.type === 'mcq') {
        await answerMcqWrong(page, ex);
      } else {
        await answerCorrectly(page, ex);
      }
      await page.getByRole('button', { name: 'Check' }).click();
      // No solutions during the test.
      await expect(page.getByRole('status').filter({ hasText: 'Answer saved.' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Result' })).toHaveCount(0);
      if (ex.type === 'mcq') answered++;
      if (answered < 2) await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Stop here' }).click();

    const res = page.getByRole('region', { name: /Your starting point/ });
    await expect(res.getByRole('heading', { level: 1 })).toHaveText(/^Your starting point: A1, unit 1$/);
    await expect(res).toContainText('(the test ended early)');
    await expect(res.getByRole('table', { name: 'Score per level' }).getByRole('row')).toHaveCount(2);
    // Already at the very start: no "start from A1 unit 1 instead".
    await expect(page.getByRole('button', { name: 'Start from A1 unit 1 instead' })).toHaveCount(0);

    const first = a1Pack().units[0]!;
    await page.getByRole('button', { name: 'Start here' }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${first.id}(/einstieg)?$`));
    await expect(page.getByRole('heading', { level: 1, name: first.title })).toBeVisible();

    await navTo(page, 'Progress');
    const card = page.getByRole('region', { name: 'Placement test' });
    await expect(card).toContainText('Placed at A1, unit 1');
    await expect(card).toContainText('(ended early)');
    await expect(card.getByRole('link', { name: 'Take the test again' })).toBeVisible();
  });

  test('all answers right: placed at the last A1 unit, can start there or from unit 1 instead', async ({ page }) => {
    test.setTimeout(120_000);
    const units = a1Pack().units;
    const last = units[units.length - 1]!;
    await onboard(page, { start: 'placement' });
    await page.getByRole('button', { name: 'Start the test' }).click();

    const counter = page.getByText(/^\d+ \/ \d+$/);
    const total = Number((await counter.textContent())!.split('/')[1]!.trim());
    expect(total).toBeGreaterThan(5);
    for (let i = 0; i < total; i++) {
      await expect(counter).toHaveText(`${i + 1} / ${total}`);
      const ex = exerciseById(await shownExerciseId(page));
      await answerCorrectly(page, ex);
      await page.getByRole('button', { name: 'Check' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Answer saved.' })).toBeVisible();
      await page.getByRole('button', { name: i + 1 < total ? 'Next' : 'See result', exact: true }).click();
    }

    const res = page.getByRole('region', { name: /Your starting point/ });
    await expect(res.getByRole('heading', { level: 1 })).toHaveText(`Your starting point: A1, unit ${last.number}`);
    await expect(res).toContainText(last.title);
    await expect(res).toContainText(`You scored 100% on A1, which means you've mastered it.`);
    await expect(res).toContainText(`${total} of ${total} questions answered.`);
    await expect(res).not.toContainText('ended early');
    const row = res.getByRole('table', { name: 'Score per level' }).getByRole('row').nth(1);
    await expect(row.getByRole('cell')).toHaveText(['A1', String(total), '100%', 'mastered']);
    await page.getByRole('button', { name: 'Start here' }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${last.id}(/einstieg)?$`));
    await expect(page.getByRole('heading', { level: 1, name: last.title })).toBeVisible();

    // The result card on Progress.
    await navTo(page, 'Progress');
    const card = page.getByRole('region', { name: 'Placement test' });
    await expect(card).toContainText(`Placed at A1, unit ${last.number}`);
    await expect(card.getByRole('list', { name: 'Placement score per level' })).toHaveText(/A1\s*100%/);

    // Learn suggests the placed unit.
    await navTo(page, 'Learn');
    const items = page.getByRole('list', { name: 'A1 units' }).getByRole('listitem');
    await expect(items.filter({ hasText: 'Start here' })).toHaveCount(1);
    await expect(items.filter({ hasText: 'Start here' })).toContainText(last.title);
  });

  test('keyboard only (Enter checks, Enter moves on), then "Start from A1 unit 1 instead"', async ({ page }) => {
    test.setTimeout(120_000);
    const units = a1Pack().units;
    const last = units[units.length - 1]!;
    await onboard(page, { start: 'placement' });
    await page.getByRole('button', { name: 'Start the test' }).click();
    const counter = page.getByText(/^\d+ \/ \d+$/);
    const total = Number((await counter.textContent())!.split('/')[1]!.trim());
    for (let i = 0; i < total; i++) {
      await expect(counter).toHaveText(`${i + 1} / ${total}`);
      await answerCorrectly(page, exerciseById(await shownExerciseId(page)));
      // Keyboard: Enter checks, Enter again moves on (or shows the result after the last question).
      await pressOnPage(page, 'Enter');
      await expect(page.getByRole('status').filter({ hasText: 'Answer saved.' })).toBeVisible();
      await pressOnPage(page, 'Enter');
    }
    await expect(page.getByRole('heading', { level: 1, name: `Your starting point: A1, unit ${last.number}` })).toBeVisible();

    await page.getByRole('button', { name: 'Start from A1 unit 1 instead' }).click();
    await expect(page).toHaveURL(/\/learn\/A1$/);
    const items = page.getByRole('list', { name: 'A1 units' }).getByRole('listitem');
    await expect(items.first()).toContainText('Start here');
    await expect(items.filter({ hasText: 'Start here' })).toHaveCount(1);

    // The placement result itself is kept.
    await navTo(page, 'Progress');
    await expect(page.getByRole('region', { name: 'Placement test' })).toContainText(`Placed at A1, unit ${last.number}`);
  });
});

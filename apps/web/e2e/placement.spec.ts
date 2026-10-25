import { a1Pack, allPacks, answerCorrectly, answerMcqWrong, exerciseById, expect, navTo, onboard, pressOnPage, shownExerciseId, test } from './fixtures';

// The placement test runs on the real packs: one section per installed level (A1, and since v0.5 the
// A2 preview with units 1–3). The adaptive stop after a failed level is covered by
// src/screens/Placement.test.tsx; here every answer is right or the test is stopped inside A1.
const levels = () => allPacks().map((p) => p.level);
/** Where a learner who answers everything right ends up: the last unit of the highest installed level. */
const topPack = () => allPacks()[allPacks().length - 1]!;
const lastUnit = () => topPack().units[topPack().units.length - 1]!;

test.describe('placement test', () => {
  test('intro: sections, length and the rules are explained before starting', async ({ page }) => {
    await onboard(page, { start: 'placement' });
    const intro = page.getByRole('region', { name: 'Placement test' });
    await expect(intro.getByRole('heading', { level: 1, name: 'Placement test' })).toBeVisible();
    const n = levels().length;
    await expect(intro).toContainText(new RegExp(`\\d+ questions in ${n} sections? \\(${levels().join(', ')}\\), about \\d+ minutes\\.`));
    await expect(intro).toContainText('If a level is clearly too hard, the test ends there.');
    await expect(intro).toContainText("You won't see the answers during the test");
    await page.getByRole('button', { name: 'Start the test' }).click();

    const sections = page.getByRole('list', { name: 'Sections' });
    await expect(sections.getByRole('listitem')).toHaveText(levels());
    await expect(sections.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
    await expect(page.getByText(new RegExp(`^Section 1 of ${levels().length}: A1 · question 1 of \\d+$`))).toBeVisible();
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

  test('all answers right: placed at the last unit of the highest level, can start there or from unit 1 instead', async ({ page }) => {
    test.setTimeout(120_000);
    const last = lastUnit();
    const top = topPack().level;
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
    await expect(res.getByRole('heading', { level: 1 })).toHaveText(`Your starting point: ${top}, unit ${last.number}`);
    await expect(res).toContainText(last.title);
    await expect(res).toContainText(`You scored 100% on ${top}, which means you've mastered it.`);
    if (levels().length > 1) await expect(res).toContainText(`You passed ${levels().map((l) => `${l} (100%)`).join(', ')}.`);
    await expect(res).toContainText(`${total} of ${total} questions answered.`);
    await expect(res).not.toContainText('ended early');
    const rows = res.getByRole('table', { name: 'Score per level' }).getByRole('row');
    await expect(rows).toHaveCount(levels().length + 1);
    for (const [i, l] of levels().entries()) await expect(rows.nth(i + 1).getByRole('cell')).toHaveText([l, /^\d+$/, '100%', 'mastered']);
    await page.getByRole('button', { name: 'Start here' }).click();
    await expect(page).toHaveURL(new RegExp(`/unit/${last.id}(/einstieg)?$`));
    await expect(page.getByRole('heading', { level: 1, name: last.title })).toBeVisible();

    // The result card on Progress.
    await navTo(page, 'Progress');
    const card = page.getByRole('region', { name: 'Placement test' });
    await expect(card).toContainText(`Placed at ${top}, unit ${last.number}`);
    await expect(card.getByRole('list', { name: 'Placement score per level' })).toHaveText(new RegExp(levels().map((l) => `${l}\\s*100%`).join('\\s*')));

    // Learn opens the placed level and suggests the placed unit; a partial level says it is a preview.
    await navTo(page, 'Learn');
    if (topPack().units.length < 12) await expect(page.getByText(`Preview — ${topPack().units.length} of 12 units`)).toBeVisible();
    const items = page.getByRole('list', { name: `${top} units` }).getByRole('listitem');
    await expect(items.filter({ hasText: 'Start here' })).toHaveCount(1);
    await expect(items.filter({ hasText: 'Start here' })).toContainText(last.title);
  });

  test('keyboard only (Enter checks, Enter moves on), then "Start from A1 unit 1 instead"', async ({ page }) => {
    test.setTimeout(120_000);
    const last = lastUnit();
    const top = topPack().level;
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
    await expect(page.getByRole('heading', { level: 1, name: `Your starting point: ${top}, unit ${last.number}` })).toBeVisible();

    await page.getByRole('button', { name: 'Start from A1 unit 1 instead' }).click();
    await expect(page).toHaveURL(/\/learn\/A1$/);
    const items = page.getByRole('list', { name: 'A1 units' }).getByRole('listitem');
    await expect(items.first()).toContainText('Start here');
    await expect(items.filter({ hasText: 'Start here' })).toHaveCount(1);

    // The placement result itself is kept.
    await navTo(page, 'Progress');
    await expect(page.getByRole('region', { name: 'Placement test' })).toContainText(`Placed at ${top}, unit ${last.number}`);
  });
});

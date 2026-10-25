// v0.4 mock exams: the /exam list, a full timed run of a1-mock-1 (page.clock drives the countdown),
// the Swiss check, and listening items that play their transcript without showing it.
import type { Exercise, MockExam } from '@doppelpunkt/content-schema';
import type { Page } from '@playwright/test';
import { a1Pack, expect, navTo, onboard, test } from './fixtures';
import { stubMedia, ttsCalls } from './media';

function exam(id: string): MockExam {
  const x = a1Pack().exams.find((e) => e.id === id);
  if (!x) throw new Error(`exam ${id} missing from the A1 pack`);
  return x;
}

const card = (page: Page, ex: Exercise) => page.locator(`article[data-exercise-id="${ex.id}"]`);

/** The first spoken line of a transcript without its speaker label (what must not be on screen). */
const firstLine = (t: string) => t.split('\n')[0]!.replace(/^[^:]{1,25}:\s*/, '').trim();

/** Answers one exam item correctly (open tasks with the model text). */
async function answerItem(page: Page, ex: Exercise) {
  const c = card(page, ex);
  switch (ex.type) {
    case 'mcq':
      await c.getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: ex.options[ex.answer]!, exact: true }).click();
      return;
    case 'gap':
      for (const [i, accepted] of ex.answers.entries()) await c.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill(accepted[0]!);
      return;
    case 'transform':
    case 'translate':
      await c.getByRole('textbox').fill(ex.answers[0]!);
      return;
    case 'match': {
      const left = c.getByRole('list', { name: 'Match these' }).getByRole('button');
      const right = c.getByRole('list', { name: 'With these' });
      for (const [i, [, r]] of ex.pairs.entries()) {
        await left.nth(i).click();
        await right.getByRole('button', { name: r, exact: true }).click();
      }
      return;
    }
    case 'write':
    case 'roleplay':
      await c.getByRole('textbox', { name: /Your answer/ }).fill(ex.model);
      return;
    default:
      throw new Error(`answerItem does not handle ${ex.type}`);
  }
}

const sectionHeading = (page: Page, i: number, n: number, title: string) =>
  page.getByRole('heading', { level: 2, name: new RegExp(`Section ${i} of ${n}: ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });

test.describe('mock exams', () => {
  test('the A1 Learn card leads to the exam list with both A1 exams', async ({ page }) => {
    await onboard(page);
    await page.getByRole('link', { name: /A1 mock exam/ }).click();
    await expect(page).toHaveURL(/\/exam$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mock exams' })).toBeVisible();
    for (const id of ['a1-mock-1', 'a1-schwiiz-1']) {
      const x = exam(id);
      const c = page.getByRole('article', { name: x.title });
      await expect(c).toBeVisible();
      await expect(c).toContainText(`pass mark ${Math.round(x.passMark * 100)}%`);
      await expect(c.getByRole('link', { name: 'Start' })).toHaveAttribute('href', `/exam/${id}`);
    }
    await expect(page.getByRole('article', { name: exam('a1-mock-1').title })).toContainText('Goethe-Zertifikat format');
  });

  test('a1-mock-1: timed sections without feedback, pause, time-out, self-scoring, results, review, Progress', async ({ page }) => {
    test.setTimeout(150_000);
    const x = exam('a1-mock-1');
    const n = x.sections.length;
    await page.clock.install();
    await stubMedia(page);
    await onboard(page);
    await page.goto(`/exam/${x.id}`);

    // Intro.
    await expect(page.getByRole('heading', { level: 1, name: x.title })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Sections' }).getByRole('row')).toHaveCount(n + 1);
    await expect(page.getByText(/This is practice, not an official certificate/)).toBeVisible();
    await page.getByRole('button', { name: 'Start the exam' }).click();

    // Section 1 (Hören, Teil 1): listening items play their transcript; nothing of it is on screen.
    const s1 = x.sections[0]!;
    await expect(sectionHeading(page, 1, n, s1.title)).toBeFocused();
    await expect(page.getByRole('timer')).toHaveText(`${s1.minutes}:00`);
    for (const ex of s1.exercises) {
      expect(ex.transcript, `${ex.id} has a transcript`).toBeTruthy();
      await expect(page.getByText(firstLine(ex.transcript!), { exact: false })).toHaveCount(0);
      await expect(card(page, ex)).not.toContainText(firstLine(ex.transcript!));
    }
    const first = s1.exercises[0]!;
    await card(page, first).getByRole('button', { name: 'Play item 1', exact: true }).click();
    await expect.poll(async () => (await ttsCalls(page)).length).toBe(1);
    const [spoken] = await ttsCalls(page);
    expect(spoken!.text).toContain(firstLine(first.transcript!));
    expect(spoken!.text, 'speaker labels are not read aloud').not.toMatch(/^(Frau|Mann):/m);
    expect(spoken!.lang).toBe('de-DE');

    // Answers give no feedback during the exam.
    for (const ex of s1.exercises) await answerItem(page, ex);
    await expect(page.getByRole('button', { name: 'Check' })).toHaveCount(0);
    await expect(page.getByText(/Richtig!|Not quite/)).toHaveCount(0);
    await expect(page.getByText(first.explanation)).toHaveCount(0);

    // The clock counts down; pause stops it (two minutes pass, the clock doesn't move); resume continues.
    await page.clock.fastForward(30_000);
    await expect(page.getByRole('timer')).toHaveText(new RegExp(`^${s1.minutes - 1}:[0-2]\\d$`));
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    await expect(card(page, first)).toBeHidden();
    const stopped = await page.getByRole('timer').textContent();
    await page.clock.fastForward('02:00');
    await expect(page.getByRole('timer')).toHaveText(stopped!);
    await page.getByRole('button', { name: 'Resume' }).first().click();
    await expect(card(page, first)).toBeVisible();

    // The section's time runs out: the exam moves on by itself and says so.
    await page.clock.fastForward(s1.minutes * 60_000);
    await expect(page.getByRole('status').filter({ hasText: `Time is up for ${s1.title}` })).toContainText(`moved on to ${x.sections[1]!.title}`);
    await expect(sectionHeading(page, 2, n, x.sections[1]!.title)).toBeVisible();

    // The other sections: answer everything, then move on.
    for (const [i, s] of x.sections.entries()) {
      if (i === 0) continue;
      await expect(sectionHeading(page, i + 1, n, s.title)).toBeVisible();
      for (const ex of s.exercises) await answerItem(page, ex);
      await page.getByRole('button', { name: i === n - 1 ? 'Finish the exam' : 'Next section' }).click();
    }

    // Open tasks: no key, so the learner scores them with the checklist.
    await expect(page.getByRole('heading', { level: 2, name: 'Score your writing and speaking' })).toBeFocused();
    const open = x.sections.flatMap((s) => s.exercises).filter((e) => e.type === 'write' || e.type === 'roleplay' || e.type === 'speak');
    expect(open.length).toBeGreaterThan(0);
    for (const ex of open) {
      const c = page.getByRole('article', { name: new RegExp(`^${ex.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
      const boxes = c.getByRole('checkbox');
      for (let k = 0; k < (await boxes.count()); k++) await boxes.nth(k).check();
      await c.getByRole('button', { name: 'Save my score' }).click();
      await expect(c.getByRole('status')).toContainText('scored by you');
    }
    await page.getByRole('button', { name: 'See my results' }).click();

    // Results: pass, per-section table with times, the pause and the time-out.
    await expect(page.getByRole('heading', { level: 1, name: 'Bestanden — passed' })).toBeFocused();
    await expect(page.getByText('You passed the mock exam.')).toBeVisible();
    const table = page.getByRole('table', { name: 'Points per section' });
    await expect(table.getByRole('row')).toHaveCount(n + 2);
    await expect(table.getByRole('row').nth(1)).toContainText('(time ran out)');
    await expect(table.getByRole('row').filter({ hasText: '(time ran out)' })).toHaveCount(1);
    await expect(page.getByText(/\(paused 2:0\d\)/)).toBeVisible();

    // Review: solutions, explanations and the listening transcripts.
    const review = page.getByRole('region', { name: 'Review: every answer with its solution' });
    const item1 = review.getByRole('article', { name: new RegExp(`^1\\. ${first.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
    await expect(item1).toContainText('Transcript');
    await expect(item1).toContainText(firstLine(first.transcript!));
    await expect(item1).toContainText('Solution');
    if (first.type === 'mcq') await expect(item1).toContainText(first.options[first.answer]!);
    await expect(item1).toContainText(first.explanation);
    const write = open.find((e) => e.type === 'write')!;
    await expect(review.getByRole('article', { name: new RegExp(write.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toContainText('Model answer');

    // Progress shows the exam card and the milestone line.
    await navTo(page, 'Progress');
    const examCard = page.getByRole('region', { name: 'A1 mock exam' });
    await expect(examCard).toContainText(/Latest: .* points/);
    await expect(examCard).toContainText('passed');
    await expect(examCard.getByRole('list', { name: 'Mock exam points per section' }).getByRole('listitem')).toHaveCount(n);
    await expect(page.getByRole('region', { name: 'Towards A1 complete' })).toContainText('A1 mock exam passed');
    await examCard.getByRole('link', { name: 'Review the answers' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bestanden — passed' })).toBeVisible();
  });

  test('a1-schwiiz-1: Zurich German items are read, never spoken by TTS; skipping everything fails', async ({ page }) => {
    const x = exam('a1-schwiiz-1');
    const n = x.sections.length;
    await stubMedia(page);
    await onboard(page);
    await page.goto('/exam');
    await page.getByRole('article', { name: x.title }).getByRole('link', { name: 'Start' }).click();
    await expect(page.getByRole('heading', { level: 1, name: x.title })).toBeVisible();
    await page.getByRole('button', { name: 'Start the exam' }).click();

    const s1 = x.sections[0]!;
    await expect(sectionHeading(page, 1, n, s1.title)).toBeVisible();
    const ex = s1.exercises[0]!;
    await expect(card(page, ex)).toContainText('No recording yet — read instead');
    await expect(card(page, ex)).toContainText(ex.transcript!.split('\n')[0]!);
    await expect(card(page, ex).getByRole('button', { name: /^Play/ })).toHaveCount(0);

    for (const [i, s] of x.sections.entries()) {
      await expect(sectionHeading(page, i + 1, n, s.title)).toBeVisible();
      await page.getByRole('button', { name: i === n - 1 ? 'Finish the exam' : 'Next section' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'not answered yet' })).toBeVisible();
      await page.getByRole('button', { name: 'Yes, go on' }).click();
    }
    // Recognition only: no open tasks, straight to the results.
    await expect(page.getByRole('heading', { level: 1, name: 'Nicht bestanden — not passed yet' })).toBeVisible();
    await expect(page.getByText("You didn't pass this time.")).toBeVisible();
    await expect(page.getByRole('table', { name: 'Points per section' }).getByRole('row')).toHaveCount(n + 2);
    expect(await ttsCalls(page)).toEqual([]);
  });
});

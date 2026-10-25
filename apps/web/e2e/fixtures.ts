import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Page } from '@playwright/test';
import type { CompiledUnit, Exercise, LevelPack } from '@doppelpunkt/content-schema';

type Fixtures = {
  /** Console errors and uncaught exceptions seen during the test; checked after every test. */
  consoleErrors: string[];
  /** Messages matching these are expected in this test (e.g. failed requests while offline). */
  allowConsole: RegExp[];
};

export const test = base.extend<Fixtures>({
  allowConsole: [[], { option: true }],
  consoleErrors: [
    async ({ page, allowConsole }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      await use(errors);
      const unexpected = errors.filter((e) => !allowConsole.some((re) => re.test(e)));
      expect(unexpected, 'no console errors or uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The A1 pack exactly as the app serves it (from the production build). */
let cached: LevelPack | undefined;
export function a1Pack(): LevelPack {
  cached ??= JSON.parse(readFileSync(fileURLToPath(new URL('../dist/packs/a1.json', import.meta.url)), 'utf8')) as LevelPack;
  return cached;
}

export function unit1(): CompiledUnit {
  const u = a1Pack().units.find((x) => x.number === 1);
  if (!u) throw new Error('A1 unit 1 missing from the pack');
  return u;
}

export const isSwiss = (e: Exercise) => e.variety === 'gsw-zh' || e.variety === 'gsw-be';

/** Exercises in the order the Übungen step lists them (Swiss dialect items live in the Schwiiz step). */
export function uebungen(unit: CompiledUnit): Exercise[] {
  return unit.exercises.filter((e) => !isSwiss(e));
}

export function firstOfType<T extends Exercise['type']>(list: Exercise[], type: T): { ex: Extract<Exercise, { type: T }>; index: number } {
  const index = list.findIndex((e) => e.type === type);
  if (index < 0) throw new Error(`no ${type} exercise`);
  return { ex: list[index] as Extract<Exercise, { type: T }>, index };
}

export type OnboardOptions = {
  /** Home dialect for the Swiss lane (default Zurich). */
  dialect?: 'Zurich' | 'Bern';
  /** "new" starts at A1 unit 1 and lands on Learn; "placement" opens the placement test intro. */
  start?: 'new' | 'placement';
};

/** Walks through onboarding as a new learner (by default: Zurich, starting at A1 unit 1). */
export async function onboard(page: Page, opts: OnboardOptions = {}) {
  const { dialect = 'Zurich', start = 'new' } = opts;
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Doppelpunkt', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByRole('heading', { name: 'Which Swiss German do you want to hear?' })).toBeVisible();
  const choice = page.getByRole('radio', { name: new RegExp(dialect) });
  await choice.click();
  await expect(choice).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'How much time per day?' })).toBeVisible();
  await page.getByRole('radio', { name: '15 min' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Where do you want to start?' })).toBeVisible();
  if (start === 'placement') {
    await page.getByRole('button', { name: /I know some German/ }).click();
    await expect(page).toHaveURL(/\/placement$/);
    return;
  }
  await page.getByRole('button', { name: /I'm new to German/ }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole('list', { name: 'A1 units' })).toBeVisible();
}

/** Clicks a main navigation link (sidebar on desktop, bottom bar on mobile). */
export async function navTo(page: Page, name: 'Learn' | 'Review' | 'Tutor' | 'Progress' | 'Settings') {
  await page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name }).click();
}

/** The feedback panel shown after "Check". */
export const result = (page: Page) => page.getByRole('region', { name: 'Result' });

/**
 * Splits a word-order solution into the exercise's tokens, so the test can tap them in order.
 * Tokens may contain spaces ("Frau Keller"); punctuation at the end of the solution is ignored.
 */
export function orderTokens(tokens: string[], solution: string): string[] {
  let rest = solution.replace(/[.?!]+$/, '').trim();
  const free = tokens.map((t, i) => ({ t, i }));
  const out: string[] = [];
  while (rest) {
    const match = free
      .filter(({ t }) => rest.startsWith(t) && (rest.length === t.length || /[\s,]/.test(rest[t.length] ?? '')))
      .sort((a, b) => b.t.length - a.t.length)[0];
    if (!match) throw new Error(`cannot split "${solution}" into ${JSON.stringify(tokens)}`);
    out.push(match.t);
    free.splice(free.indexOf(match), 1);
    rest = rest.slice(match.t.length).replace(/^[\s,]+/, '');
  }
  return out;
}

export const escapeRegExp = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every exercise in the A1 pack by id. */
export function exerciseById(id: string): Exercise {
  for (const u of a1Pack().units) {
    const ex = u.exercises.find((e) => e.id === id);
    if (ex) return ex;
  }
  throw new Error(`exercise ${id} not in the A1 pack`);
}

/** Id of the exercise currently shown (the card's heading id is `ex-<id>-prompt`). */
export async function shownExerciseId(page: Page): Promise<string> {
  const id = await page.locator('article h3[id^="ex-"]').first().getAttribute('id');
  if (!id) throw new Error('no exercise on screen');
  return id.replace(/^ex-/, '').replace(/-prompt$/, '');
}

/** Opens one exercise of a unit step directly (`?item=`), leaving focus on the page body. */
export async function openItem(page: Page, unit: CompiledUnit, ex: Exercise) {
  const step = isSwiss(ex) ? 'schwiiz' : 'uebungen';
  await page.goto(`/unit/${unit.id}/${step}?item=${ex.id}`);
  await expect(page.getByRole('heading', { level: 3, name: ex.prompt })).toBeVisible();
}

/** Gives the correct answer to a closed exercise (mcq, gap, order, match) without pressing Check. */
export async function answerCorrectly(page: Page, ex: Exercise) {
  const card = page.getByRole('article');
  switch (ex.type) {
    case 'mcq':
      await card.getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: ex.options[ex.answer]!, exact: true }).click();
      return;
    case 'gap':
      for (const [i, accepted] of ex.answers.entries()) await card.getByRole('textbox', { name: `Gap ${i + 1}`, exact: true }).fill(accepted[0]!);
      return;
    case 'order': {
      const words = card.getByRole('group', { name: 'Words' });
      for (const t of orderTokens(ex.tokens, ex.answers[0]!)) {
        await words.getByRole('button', { name: t, exact: true }).and(page.locator(':enabled')).first().click();
      }
      return;
    }
    case 'match': {
      // The left column keeps content order; the right column is shuffled.
      const left = card.getByRole('list', { name: 'Match these' }).getByRole('button');
      const right = card.getByRole('list', { name: 'With these' });
      for (const [i, [, r]] of ex.pairs.entries()) {
        await left.nth(i).click();
        await right.getByRole('button', { name: r, exact: true }).click();
      }
      return;
    }
    default:
      throw new Error(`answerCorrectly does not handle ${ex.type}`);
  }
}

/** Gives a wrong answer to a multiple-choice item. */
export async function answerMcqWrong(page: Page, ex: Extract<Exercise, { type: 'mcq' }>) {
  const wrong = ex.options.find((_, i) => i !== ex.answer)!;
  await page.getByRole('article').getByRole('radiogroup', { name: 'Options' }).getByRole('radio', { name: wrong, exact: true }).click();
}

/** Presses a key with nothing focused (as after a mouse click on the page background). */
export async function pressOnPage(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press(key);
}

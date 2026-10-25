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

const isSwiss = (e: Exercise) => e.variety === 'gsw-zh' || e.variety === 'gsw-be';

/** Exercises in the order the Übungen step lists them (Swiss dialect items live in the Schwiiz step). */
export function uebungen(unit: CompiledUnit): Exercise[] {
  return unit.exercises.filter((e) => !isSwiss(e));
}

export function firstOfType<T extends Exercise['type']>(list: Exercise[], type: T): { ex: Extract<Exercise, { type: T }>; index: number } {
  const index = list.findIndex((e) => e.type === type);
  if (index < 0) throw new Error(`no ${type} exercise`);
  return { ex: list[index] as Extract<Exercise, { type: T }>, index };
}

/** Walks through onboarding as a new learner who starts at A1 unit 1. */
export async function onboard(page: Page) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Doppelpunkt', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page.getByRole('heading', { name: 'Which Swiss German do you want to hear?' })).toBeVisible();
  const zurich = page.getByRole('radio', { name: /Zurich/ });
  await zurich.click();
  await expect(zurich).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'How much time per day?' })).toBeVisible();
  await page.getByRole('radio', { name: '15 min' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Where do you want to start?' })).toBeVisible();
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

// v0.4 A1 can-do checklist and the "A1 complete" milestone on Progress. Progress is seeded straight
// into the app's IndexedDB (Dexie database "doppelpunkt") and the page reloaded.
import type { Page } from '@playwright/test';
import { a1Pack, escapeRegExp, expect, navTo, onboard, test } from './fixtures';

type Seed = { unitStatus?: unknown[]; attempts?: unknown[]; examResults?: unknown[] };

async function seed(page: Page, rows: Seed) {
  await page.evaluate(async (data: Seed) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('doppelpunkt');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const stores = Object.keys(data).filter((k) => (data as Record<string, unknown[]>)[k]?.length);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      for (const s of stores) for (const row of (data as Record<string, unknown[]>)[s]!) tx.objectStore(s).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, rows);
  await page.reload();
}

const at = '2026-10-20T10:00:00.000Z';
const status = (unitId: string, canDo: boolean[], done = true) => ({ unitId, startedAt: at, ...(done ? { completedAt: at } : {}), visited: ['check'], canDo });

test.describe('A1 can-do checklist and milestone', () => {
  test('a passed unit check ticks its can-do statements; others can be ticked by hand', async ({ page }) => {
    const [u1, u2] = [...a1Pack().units].sort((a, b) => a.number - b.number);
    await onboard(page);
    // Unit 1: marked done and every exercise answered right → the unit check is passed.
    await seed(page, {
      unitStatus: [status(u1!.id, u1!.canDo.map(() => false))],
      attempts: u1!.exercises.map((e) => ({ exerciseId: e.id, unitId: u1!.id, level: 'A1', skill: e.skill, variety: e.variety, score: 1, grammar: e.grammar, at })),
    });
    await navTo(page, 'Progress');
    const list = page.getByRole('region', { name: 'A1 can-do checklist' });
    await expect(list).toBeVisible();
    const g1 = list.getByRole('group', { name: new RegExp(`1\\. ${escapeRegExp(u1!.title)}`) });
    await expect(g1).toContainText('Check passed');
    for (const text of u1!.canDo) {
      const box = g1.getByRole('checkbox', { name: text, exact: true });
      await expect(box).toBeChecked();
      await expect(box).toBeDisabled();
    }
    await expect(g1).toContainText('Ticked because you passed the unit check.');

    // Unit 2: not done, so its statements are ticked by hand, and the tick is saved.
    const g2 = list.getByRole('group', { name: new RegExp(`2\\. ${escapeRegExp(u2!.title)}`) });
    const box = g2.getByRole('checkbox', { name: u2!.canDo[0]!, exact: true });
    await expect(box).not.toBeChecked();
    await expect(box).toBeEnabled();
    await box.click();
    await expect(box).toBeChecked();
    const total = a1Pack().units.reduce((n, u) => n + u.canDo.length, 0);
    await expect(page.getByRole('region', { name: 'Towards A1 complete' })).toContainText(`Can-do statements: ${u1!.canDo.length + 1} of ${total}`);
    await page.reload();
    await expect(page.getByRole('region', { name: 'A1 can-do checklist' }).getByRole('group', { name: new RegExp(`2\\. ${escapeRegExp(u2!.title)}`) }).getByRole('checkbox', { name: u2!.canDo[0]!, exact: true })).toBeChecked();
    // The same tick shows on the unit's own Check step.
    await page.goto(`/unit/${u2!.id}/check`);
    await expect(page.getByRole('checkbox', { name: u2!.canDo[0]!, exact: true })).toBeChecked();
  });

  test('"A1 complete" needs all 12 units done and a passed mock exam', async ({ page }) => {
    const units = a1Pack().units;
    expect(units).toHaveLength(12);
    const x = a1Pack().exams.find((e) => e.id === 'a1-mock-1')!;
    await onboard(page);
    await seed(page, { unitStatus: units.map((u) => status(u.id, u.canDo.map(() => false))) });
    await navTo(page, 'Progress');
    const towards = page.getByRole('region', { name: 'Towards A1 complete' });
    await expect(towards).toContainText('Units marked as done: 12 of 12');
    await expect(towards).toContainText('A1 mock exam not passed yet');

    const sections = x.sections.map((s) => ({ sectionId: s.id, points: 1, max: 1, usedSec: 60, timedOut: false }));
    await seed(page, {
      examResults: [{ examId: x.id, level: 'A1', at, points: 50, max: 60, passMark: x.passMark, passed: true, durationSec: 3600, pausedSec: 0, sections, items: [] }],
    });
    const done = page.getByRole('region', { name: 'A1 complete' });
    await expect(done).toContainText('Herzlichen Glückwunsch! You finished all 12 A1 units and passed the mock exam.');
    await expect(page.getByRole('region', { name: 'A1 mock exam' })).toContainText('50 of 60 points');
  });
});

// Answer-key sanity over the real course content (units and mock exams): checks the linter does not
// make, plus regressions for content errors found in v1.0 QA.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '@doppelpunkt/content-schema';
import { loadExams } from '../src/exam';
import { loadContent } from '../src/load';

const CONTENT = fileURLToPath(new URL('../../content', import.meta.url));
const { units } = loadContent(CONTENT);
const { exams } = loadExams(CONTENT);

const all: Array<{ where: string; ex: Exercise }> = [
  ...units.flatMap((u) => u.unit.exercises.map((ex) => ({ where: u.unit.id, ex }))),
  ...exams.flatMap((e) => e.exam.sections.flatMap((s) => s.exercises.map((ex) => ({ where: `${e.exam.id}/${s.id}`, ex })))),
];
const words = (s: string) => s.replace(/[.?!,]/g, '').toLowerCase().split(/\s+/).filter(Boolean).sort();

describe('answer keys', () => {
  it('loads the course', () => {
    expect(units.length).toBeGreaterThanOrEqual(24);
    expect(exams.length).toBeGreaterThanOrEqual(4);
  });

  it('mcq: the answer index is in range, options are distinct, and only the answer\'s rationale says "Correct"', () => {
    const bad: string[] = [];
    for (const { where, ex } of all) {
      if (ex.type !== 'mcq') continue;
      if (ex.answer < 0 || ex.answer >= ex.options.length) bad.push(`${where} ${ex.id}: answer out of range`);
      if (new Set(ex.options).size !== ex.options.length) bad.push(`${where} ${ex.id}: duplicate options`);
      ex.rationales?.forEach((r, i) => {
        if ((i === ex.answer) !== /^(correct|right)[.!:]/i.test(r)) bad.push(`${where} ${ex.id}: rationale ${i} vs answer ${ex.answer}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('gap: one answer list per ___', () => {
    const bad = all.flatMap(({ where, ex }) => (ex.type === 'gap' && ex.text.split('___').length - 1 !== ex.answers.length ? [`${where} ${ex.id}`] : []));
    expect(bad).toEqual([]);
  });

  it('order: every accepted answer uses exactly the given tokens', () => {
    const bad: string[] = [];
    for (const { where, ex } of all) {
      if (ex.type !== 'order') continue;
      const tokens = words(ex.tokens.join(' ')).join(' ');
      for (const a of ex.answers) if (words(a).join(' ') !== tokens) bad.push(`${where} ${ex.id}: ${a}`);
    }
    expect(bad).toEqual([]);
  });

  it('regressions from v1.0 QA', () => {
    const find = (id: string) => all.find((x) => x.ex.id === id)?.ex;
    // "Fr. 89.–" is 89 francs; the explanation says prices are not in euros.
    const prices = find('a2-u06-chstd-match');
    expect(prices?.type === 'match' && prices.pairs.find(([sw]) => sw === 'Fr. 89.–')?.[1]).toBe('89 Franken');
    // "es regnet den ganzen Tag" (accusative of time), not "am ganzen Tag".
    const weather = find('a2-mock1-h1-wetter');
    expect(weather?.type === 'mcq' && weather.transcript).toContain('es regnet den ganzen Tag');
    expect(JSON.stringify(exams.map((e) => e.exam))).not.toContain('am ganzen Tag');
  });
});

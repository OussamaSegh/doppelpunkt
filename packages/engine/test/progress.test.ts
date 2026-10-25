import { describe, expect, it } from 'vitest';
import type { CompiledUnit, Level, Skill, Variety } from '@doppelpunkt/content-schema';
import { errorProfile, estimateSkills, longestStreak, streak, unitProgress, weeklyMinutes, type Attempt } from '../src';

const at = (day: number) => new Date(Date.UTC(2026, 0, day, 10)).toISOString();
function att(p: Partial<Attempt> & { score: number }): Attempt {
  return {
    exerciseId: 'e1', unitId: 'a1-u01', level: 'A1' as Level, skill: 'grammar' as Skill, variety: 'de' as Variety,
    grammar: [], at: at(1), ...p,
  };
}
const many = (n: number, p: Partial<Attempt> & { score: number }) => Array.from({ length: n }, (_, i) => att({ exerciseId: `e${i}`, ...p }));

describe('estimateSkills', () => {
  it('returns all skills plus swiss, defaulting to A1 with zero confidence', () => {
    const est = estimateSkills([]);
    expect(est.map((e) => e.skill)).toEqual(['reading', 'listening', 'speaking', 'writing', 'vocabulary', 'grammar', 'swiss']);
    expect(est.every((e) => e.band === 'A1' && e.confidence === 0 && e.attempts === 0)).toBe(true);
  });
  it('maps mastery across levels to bands', () => {
    const band = (a: Attempt[]) => estimateSkills(a).find((e) => e.skill === 'grammar')!.band;
    expect(band(many(5, { score: 0.3 }))).toBe('A1');
    expect(band(many(5, { score: 0.6 }))).toBe('A1+');
    expect(band(many(5, { score: 0.9 }))).toBe('A2');
    expect(band([...many(5, { score: 0.9 }), ...many(5, { level: 'A2', score: 0.5 })])).toBe('A2+');
    expect(band([...many(5, { score: 0.9 }), ...many(5, { level: 'A2', score: 0.9 })])).toBe('B1');
  });
  it('does not let a high level skip a weak lower level', () => {
    const est = estimateSkills([...many(5, { score: 0.2 }), ...many(5, { level: 'B1', score: 1 })]);
    expect(est.find((e) => e.skill === 'grammar')!.band).toBe('A1');
  });
  it('weights recent attempts more', () => {
    const old = many(10, { score: 0.2, at: at(1) });
    const recent = many(10, { score: 0.95, at: at(120) });
    expect(estimateSkills([...old, ...recent]).find((e) => e.skill === 'grammar')!.band).toBe('A2');
  });
  it('estimates a swiss band from gsw attempts and grows confidence', () => {
    const est = estimateSkills([...many(30, { variety: 'gsw-zh', skill: 'listening', score: 0.9 }), att({ score: 1 })]);
    const swiss = est.find((e) => e.skill === 'swiss')!;
    expect(swiss.attempts).toBe(30);
    expect(swiss.band).toBe('A2');
    expect(swiss.confidence).toBeGreaterThan(0.9);
    expect(est.find((e) => e.skill === 'grammar')!.confidence).toBeLessThan(0.2);
  });
});

describe('errorProfile', () => {
  it('counts grammar ids and error types weighted by failure', () => {
    const p = errorProfile([
      att({ score: 0, grammar: ['articles'], errorTypes: ['gender'] }),
      att({ score: 0.5, grammar: ['articles', 'v2'] }),
      att({ score: 1, grammar: ['v2'] }),
    ]);
    expect(p).toEqual([
      { key: 'articles', count: 1.5, kind: 'grammar' },
      { key: 'gender', count: 1, kind: 'error' },
      { key: 'v2', count: 0.5, kind: 'grammar' },
    ]);
  });
  it('is empty when everything is right', () => {
    expect(errorProfile([att({ score: 1, grammar: ['x'] })])).toEqual([]);
  });
});

describe('unitProgress', () => {
  const unit = { id: 'a1-u01', exercises: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] } as unknown as CompiledUnit;
  it('counts attempted exercises and averages the latest score', () => {
    expect(unitProgress(unit, [])).toEqual({ done: 0, total: 3, avgScore: 0 });
    const r = unitProgress(unit, [
      att({ exerciseId: 'e1', score: 0.2, at: at(1) }),
      att({ exerciseId: 'e1', score: 1, at: at(2) }),
      att({ exerciseId: 'e2', score: 0.5 }),
      att({ exerciseId: 'other', score: 0 }),
    ]);
    expect(r).toEqual({ done: 2, total: 3, avgScore: 0.75 });
  });
});

describe('streak and weekly minutes', () => {
  const today = new Date(2026, 0, 10, 15);
  it('counts consecutive days ending today or yesterday', () => {
    expect(streak(['2026-01-10', '2026-01-09', '2026-01-08', '2026-01-05'], today)).toBe(3);
    expect(streak(['2026-01-09', '2026-01-08'], today)).toBe(2);
    expect(streak(['2026-01-07'], today)).toBe(0);
    expect(streak([], today)).toBe(0);
    expect(streak([new Date(2026, 0, 10, 8), new Date(2026, 0, 10, 20)], today)).toBe(1);
  });
  it('handles month boundaries and longest streak', () => {
    expect(streak(['2026-03-01', '2026-02-28', '2026-02-27'], new Date(2026, 2, 1, 12))).toBe(3);
    expect(longestStreak(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-10', '2026-01-11'])).toBe(3);
  });
  it('sums minutes per day for the last 7 days', () => {
    const w = weeklyMinutes(
      [
        { at: new Date(2026, 0, 10, 9).toISOString(), minutes: 10 },
        { at: new Date(2026, 0, 10, 18).toISOString(), minutes: 5 },
        { at: new Date(2026, 0, 4, 9).toISOString(), minutes: 7 },
        { at: new Date(2026, 0, 1, 9).toISOString(), minutes: 99 },
      ],
      today,
    );
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ date: '2026-01-04', minutes: 7 });
    expect(w[6]).toEqual({ date: '2026-01-10', minutes: 15 });
    expect(w.reduce((s, d) => s + d.minutes, 0)).toBe(22);
  });
});

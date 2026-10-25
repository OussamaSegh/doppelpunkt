import { describe, expect, it } from 'vitest';
import { CompiledUnit, type LevelPack } from '@doppelpunkt/content-schema';
import type { AttemptRow, UnitStatusRow } from '../db';
import { fixtureUnit } from '../test/fixtures';
import { canDoChecklist, levelMilestone, unitCheck } from './cando';

const units = Array.from({ length: 12 }, (_, i) =>
  CompiledUnit.parse({
    ...fixtureUnit,
    id: `a1-u${String(i + 1).padStart(2, '0')}`,
    number: i + 1,
    canDo: [`Can-do ${i + 1}a`, `Can-do ${i + 1}b`],
    exercises: fixtureUnit.exercises.map((e) => ({ ...e, id: e.id.replace('u01', `u${String(i + 1).padStart(2, '0')}`) })),
  }),
);
const pack = (n = 12, exams = 1): LevelPack =>
  ({ level: 'A1', version: 't', builtAt: '', units: units.slice(0, n), exams: Array.from({ length: exams }, () => ({})) }) as unknown as LevelPack;

const attempt = (unitId: string, exerciseId: string, score: number): AttemptRow => ({
  unitId,
  exerciseId,
  level: 'A1',
  skill: 'grammar',
  variety: 'de',
  score,
  grammar: [],
  at: '2026-10-01T10:00:00.000Z',
});
const status = (unitId: string, done: boolean, canDo: boolean[] = [false, false]): UnitStatusRow => ({
  unitId,
  startedAt: '2026-10-01T09:00:00.000Z',
  visited: [],
  canDo,
  ...(done ? { completedAt: '2026-10-01T11:00:00.000Z' } : {}),
});
const allRight = (u: CompiledUnit) => u.exercises.map((e) => attempt(u.id, e.id, 1));

describe('unit check', () => {
  const u = units[0]!;
  it('passes when the unit is done, 80% of the exercises are answered and the average is at least 60%', () => {
    expect(unitCheck(u, allRight(u), status(u.id, true)).passed).toBe(true);
  });
  it('fails when the unit is not marked done', () => {
    expect(unitCheck(u, allRight(u), status(u.id, false)).passed).toBe(false);
  });
  it('fails with too few exercises answered (2 of 3 < 80%)', () => {
    expect(unitCheck(u, allRight(u).slice(0, 2), status(u.id, true)).passed).toBe(false);
  });
  it('fails below a 60% average, using the latest attempt per exercise', () => {
    const low = u.exercises.map((e) => attempt(u.id, e.id, 0.5));
    expect(unitCheck(u, low, status(u.id, true)).passed).toBe(false);
    const retried = [...low, { ...attempt(u.id, u.exercises[0]!.id, 1), at: '2026-10-02T10:00:00.000Z' }];
    expect(unitCheck(u, retried, status(u.id, true))).toMatchObject({ passed: true, avgScore: 2 / 3 });
  });
});

describe('can-do checklist', () => {
  it('lists every unit of the level, auto-ticks passed units and keeps manual ticks', () => {
    const [u1, u2] = units;
    const list = canDoChecklist(pack(), allRight(u1!), [status(u1!.id, true), status(u2!.id, false, [false, true])]);
    expect(list).toHaveLength(12);
    expect(list.flatMap((u) => u.items)).toHaveLength(24);
    expect(list[0]!.items.map((i) => [i.auto, i.done])).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(list[1]!.items.map((i) => [i.manual, i.auto, i.done])).toEqual([
      [false, false, false],
      [true, false, true],
    ]);
    expect(list[2]!.items.every((i) => !i.done)).toBe(true);
  });
});

describe('A1 complete milestone', () => {
  const allDone = units.map((u) => status(u.id, true));
  it('needs all 12 units marked done and a passed mock exam', () => {
    const p = pack();
    const list = canDoChecklist(p, [], allDone);
    expect(levelMilestone(p, allDone, list, true)).toMatchObject({ unitsDone: 12, allUnitsDone: true, examPassed: true, complete: true });
    expect(levelMilestone(p, allDone, list, false).complete).toBe(false);
    const eleven = allDone.slice(1);
    expect(levelMilestone(p, eleven, canDoChecklist(p, [], eleven), true)).toMatchObject({ unitsDone: 11, complete: false });
  });
  it('is not reached while fewer than 12 units are installed', () => {
    const p = pack(9);
    const done = allDone.slice(0, 9);
    expect(levelMilestone(p, done, canDoChecklist(p, [], done), true)).toMatchObject({ units: 9, unitsDone: 9, allUnitsDone: false, complete: false });
  });
  it('counts can-do statements', () => {
    const p = pack(12, 0);
    const list = canDoChecklist(p, [], [status(units[0]!.id, false, [true, false])]);
    expect(levelMilestone(p, [], list, false)).toMatchObject({ canDoDone: 1, canDoTotal: 24, hasExam: false });
  });
});

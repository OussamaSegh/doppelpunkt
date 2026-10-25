import { describe, expect, it } from 'vitest';
import type { Level, LevelPack } from '@doppelpunkt/content-schema';
import { placeLearner, placementItems } from '../src';
import { ex } from './helpers';

function pack(level: Level, count: number): LevelPack {
  const skills = ['reading', 'grammar', 'vocabulary'] as const;
  const exercises = Array.from({ length: count }, (_, i) =>
    ex({ id: `${level.toLowerCase()}-e${i}`, type: 'mcq', skill: skills[i % 3], options: ['a', 'b'], answer: 0 }),
  );
  exercises.push(ex({ id: `${level.toLowerCase()}-gsw`, type: 'mcq', variety: 'gsw-zh', options: ['a', 'b'], answer: 0 }));
  exercises.push(ex({ id: `${level.toLowerCase()}-w`, type: 'write', skill: 'writing', task: 't', model: 'm', checklist: ['c'] }));
  return { level, version: '0.1.0', builtAt: '', units: [{ id: `${level.toLowerCase()}-u01`, exercises } as never], exams: [] };
}

describe('placementItems', () => {
  const packs = [pack('A2', 12), pack('A1', 12)];
  it('samples closed Standard German items balanced over levels and skills, lowest level first', () => {
    const items = placementItems(packs, 10);
    expect(items).toHaveLength(10);
    expect(items.filter((i) => i.level === 'A1')).toHaveLength(5);
    expect(items.slice(0, 5).every((i) => i.level === 'A1')).toBe(true);
    expect(items.every((i) => i.type === 'mcq' && i.variety === 'de')).toBe(true);
    const a1Skills = items.filter((i) => i.level === 'A1').map((i) => i.skill);
    for (const s of ['reading', 'grammar', 'vocabulary']) expect(a1Skills.filter((x) => x === s).length).toBeGreaterThanOrEqual(1);
    expect(new Set(items.map((i) => i.id)).size).toBe(10);
    expect(items[0]!.unitId).toBe('a1-u01');
  });
  it('is deterministic per seed and copes with small or empty packs', () => {
    expect(placementItems(packs, 10, 7)).toEqual(placementItems(packs, 10, 7));
    expect(placementItems([pack('A1', 3)], 20)).toHaveLength(3);
    expect(placementItems([], 20)).toEqual([]);
  });
});

describe('placeLearner', () => {
  it('starts beginners at A1 unit 1', () => {
    expect(placeLearner([])).toEqual({ level: 'A1', unit: 1 });
    expect(placeLearner([{ level: 'A1', score: 0.5 }])).toEqual({ level: 'A1', unit: 1 });
  });
  it('places inside the highest passed level by score', () => {
    expect(placeLearner([{ level: 'A1', score: 0.7 }])).toEqual({ level: 'A1', unit: 1 });
    expect(placeLearner([{ level: 'A1', score: 0.8 }, { level: 'A1', score: 0.8 }])).toEqual({ level: 'A1', unit: 7 });
    expect(placeLearner([{ level: 'A1', score: 1 }, { level: 'A2', score: 0.75 }, { level: 'B1', score: 0.2 }])).toEqual({ level: 'A2', unit: 4 });
  });
  it('moves up a level when a level is mastered', () => {
    expect(placeLearner([{ level: 'A1', score: 0.95 }, { level: 'A2', score: 0.3 }])).toEqual({ level: 'A2', unit: 1 });
  });
  it('does not skip a failed lower level', () => {
    expect(placeLearner([{ level: 'A1', score: 0.4 }, { level: 'A2', score: 1 }])).toEqual({ level: 'A1', unit: 1 });
  });
  it('respects available units', () => {
    expect(placeLearner([{ level: 'A1', score: 0.85 }], { A1: 3 })).toEqual({ level: 'A1', unit: 3 });
    expect(placeLearner([{ level: 'A1', score: 1 }], { A1: 3 })).toEqual({ level: 'A1', unit: 3 });
    expect(placeLearner([{ level: 'C2', score: 1 }, { level: 'A1', score: 1 }])).toEqual({ level: 'C2', unit: 12 });
  });
  it('with a partial A2 pack (A2 units 1–3 only): A1 placement is unchanged, A2 placement stays inside the installed units', () => {
    const units = { A1: 12, A2: 3 };
    expect(placeLearner([{ level: 'A1', score: 0.8 }, { level: 'A2', score: 0.2 }], units)).toEqual({ level: 'A1', unit: 7 });
    expect(placeLearner([{ level: 'A1', score: 0.95 }, { level: 'A2', score: 0.3 }], units)).toEqual({ level: 'A2', unit: 1 });
    expect(placeLearner([{ level: 'A1', score: 1 }, { level: 'A2', score: 0.75 }], units)).toEqual({ level: 'A2', unit: 3 });
    // A2 mastered but B1 not installed: the last installed A2 unit.
    expect(placeLearner([{ level: 'A1', score: 1 }, { level: 'A2', score: 1 }], units)).toEqual({ level: 'A2', unit: 3 });
  });
});

describe('placementItems with a partial A2 pack', () => {
  it('splits the test over A1 and A2 even when A2 has few units', () => {
    const items = placementItems([pack('A1', 30), pack('A2', 9)], 30);
    expect(items.filter((i) => i.level === 'A1')).toHaveLength(15);
    expect(items.filter((i) => i.level === 'A2')).toHaveLength(9);
    expect(items.findIndex((i) => i.level === 'A2')).toBe(15);
  });
});

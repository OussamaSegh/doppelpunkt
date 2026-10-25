import { describe, expect, it } from 'vitest';
import { MockExam } from '@doppelpunkt/content-schema';
import { ALMOST_SCORE, examMaxPoints, scoreExam, sectionPoints, SPEECH_NEAR_CREDIT } from '../src';

const base = { prompt: 'Do it.', explanation: 'Because.' };
const exam = MockExam.parse({
  id: 'a1-mock-1',
  level: 'A1',
  title: 'Modelltest 1',
  passMark: 0.6,
  sections: [
    {
      id: 'hoeren', skill: 'listening', title: 'Hören', minutes: 20, instructions: 'Listen.',
      exercises: [
        { ...base, id: 'h1', type: 'mcq', skill: 'listening', options: ['a', 'b', 'c'], answer: 2 },
        { ...base, id: 'h2', type: 'mcq', skill: 'listening', options: ['a', 'b'], answer: 0 },
      ],
    },
    {
      id: 'lesen', skill: 'reading', title: 'Lesen', minutes: 25, instructions: 'Read.',
      exercises: [
        { ...base, id: 'l1', type: 'gap', skill: 'reading', text: 'Ich ___ Anna, ich ___ aus ___.', answers: [['heisse', 'heiße'], ['komme'], ['Berlin']] },
        { ...base, id: 'l2', type: 'translate', skill: 'reading', source: 'Guten Morgen', answers: ['Good morning'] },
      ],
      points: [3, 1],
    },
    {
      id: 'schreiben', skill: 'writing', title: 'Schreiben', minutes: 20, instructions: 'Write.',
      exercises: [{ ...base, id: 'w1', type: 'write', skill: 'writing', task: 'Write.', model: 'Hallo.', checklist: ['greeting'] }],
      points: [10],
    },
    {
      id: 'sprechen', skill: 'speaking', title: 'Sprechen', minutes: 15, instructions: 'Speak.',
      exercises: [
        { ...base, id: 's1', type: 'speak', skill: 'speaking', target: 'Ich bin fünf.' },
        { ...base, id: 's2', type: 'roleplay', skill: 'speaking', scenario: 'Café', goals: ['order'], model: 'Einen Kaffee, bitte.' },
      ],
      points: [3, 4],
    },
  ],
});

describe('scoreExam', () => {
  it('computes points per item and section', () => {
    expect(sectionPoints(exam.sections[1]!)).toEqual([3, 1]);
    expect(examMaxPoints(exam)).toBe(2 + 4 + 10 + 7);
    const r = scoreExam(
      exam,
      { h1: 2, h2: 1, l1: ['heisse', 'komme', 'Wien'], l2: 'Good morning', s1: 'ich bin 5' },
      { w1: 0.8, s2: 0.5 },
    );
    expect(r.max).toBe(23);
    expect(r.items.map((i) => [i.id, i.points, i.max])).toEqual([
      ['h1', 1, 1], ['h2', 0, 1], ['l1', 2, 3], ['l2', 1, 1], ['w1', 8, 10], ['s1', 3, 3], ['s2', 2, 4],
    ]);
    expect(r.items.find((i) => i.id === 'w1')!.result).toBeNull();
    expect(r.items.find((i) => i.id === 'h1')!.result).toMatchObject({ correct: true });
    expect(r.items.find((i) => i.id === 's1')!.result).toMatchObject({ correct: true });
    expect(r.sections).toEqual([
      { id: 'hoeren', skill: 'listening', points: 1, max: 2, ratio: 0.5 },
      { id: 'lesen', skill: 'reading', points: 3, max: 4, ratio: 0.75 },
      { id: 'schreiben', skill: 'writing', points: 8, max: 10, ratio: 0.8 },
      { id: 'sprechen', skill: 'speaking', points: 5, max: 7, ratio: 5 / 7 },
    ]);
    expect(r.total).toBe(17);
    expect(r.ratio).toBeCloseTo(17 / 23);
    expect(r.passed).toBe(true);
  });
  it('gives 0 with result null for unanswered items and fails below the pass mark', () => {
    const r = scoreExam(exam, {});
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
    expect(r.items.every((i) => i.result === null && i.points === 0)).toBe(true);
    expect(scoreExam(exam, { h1: 2, l1: '' }).items.find((i) => i.id === 'l1')!.result).toBeNull();
  });
  it('passes exactly at the pass mark and clamps open scores to 0..1', () => {
    const r = scoreExam(exam, {}, { w1: 2, s2: -1 });
    expect(r.items.find((i) => i.id === 'w1')!.points).toBe(10);
    expect(r.items.find((i) => i.id === 's2')!.points).toBe(0);
    const small = MockExam.parse({ ...exam, passMark: 0.5, sections: [exam.sections[0]] });
    expect(scoreExam(small, { h1: 2, h2: 1 }).passed).toBe(true);
    expect(scoreExam(small, { h1: 1, h2: 1 }).passed).toBe(false);
  });
  it('gives partial credit for near misses and uses open scores for needsAi items and speak', () => {
    const r = scoreExam(exam, { l2: 'Hello there friend', s1: 'ich bin funf' }, { l2: 1 });
    expect(r.items.find((i) => i.id === 'l2')).toMatchObject({ points: 1, result: { needsAi: true } });
    // "funf" for "fünf": near credit and the ü hint.
    const s1 = r.items.find((i) => i.id === 's1')!;
    expect(s1.result!.hints![0]!.id).toBe('ue');
    expect(s1.points).toBeCloseTo(3 * ((2 + SPEECH_NEAR_CREDIT) / 3), 1);
    const near = scoreExam(exam, { l1: ['heisse', 'komme', 'Berlim'] });
    expect(near.items.find((i) => i.id === 'l1')!.points).toBeCloseTo(3 * ((2 + ALMOST_SCORE) / 3), 1);
    // An open score overrides the speech transcript.
    expect(scoreExam(exam, { s1: 'nichts' }, { s1: 1 }).items.find((i) => i.id === 's1')!.points).toBe(3);
  });
});

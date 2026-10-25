import { describe, expect, it } from 'vitest';
import { PronunciationDrill } from '@doppelpunkt/content-schema';
import { drillUnitId, estimateSkills, minimalPairQuiz, type Attempt } from '../src';

const drill = PronunciationDrill.parse({
  id: 'ue-u',
  title: 'ü vs u',
  explanation: 'Round your lips.',
  pairs: [
    [{ text: 'Mütter', en: 'mothers' }, { text: 'Mutter', en: 'mother' }],
    [{ text: 'Tür', en: 'door' }, { text: 'Tour', en: 'tour' }],
    [{ text: 'fühlen', en: 'to feel' }, { text: 'Fuhren', en: 'drove' }],
  ],
  words: [{ text: 'fünf', en: 'five' }],
});

describe('minimalPairQuiz', () => {
  it('returns n items whose answer points at the played word', () => {
    const q = minimalPairQuiz(drill, 6, 42);
    expect(q).toHaveLength(6);
    for (const item of q) {
      expect(item.options[item.answer]).toBe(item.play);
      expect(drill.pairs[item.pair]).toContain(item.play);
      expect(new Set(item.options.map((o) => o.text))).toEqual(new Set(drill.pairs[item.pair]!.map((w) => w.text)));
      expect(item.id).toMatch(/^ue-u-mp-\d-[ab]$/);
    }
  });
  it('plays every word once per round and avoids repeating a pair back to back', () => {
    const q = minimalPairQuiz(drill, 6, 'seed');
    expect(new Set(q.map((i) => i.id)).size).toBe(6);
    for (let i = 1; i < q.length; i++) expect(q[i]!.pair).not.toBe(q[i - 1]!.pair);
  });
  it('is deterministic per seed and differs between seeds', () => {
    expect(minimalPairQuiz(drill, 10, 7)).toEqual(minimalPairQuiz(drill, 10, 7));
    const a = JSON.stringify(minimalPairQuiz(drill, 10, 1));
    const others = [2, 3, 4, 5].map((s) => JSON.stringify(minimalPairQuiz(drill, 10, s)));
    expect(others.some((o) => o !== a)).toBe(true);
  });
  it('cycles beyond one round and mixes the answer position', () => {
    const q = minimalPairQuiz(drill, 30, 3);
    expect(q).toHaveLength(30);
    const answers = new Set(q.map((i) => i.answer));
    expect(answers).toEqual(new Set([0, 1]));
  });
  it('handles a single pair, no pairs and n <= 0', () => {
    const one = { id: 'x', pairs: [drill.pairs[0]!] };
    expect(minimalPairQuiz(one, 3, 1)).toHaveLength(3);
    expect(minimalPairQuiz({ id: 'x', pairs: [] }, 5)).toEqual([]);
    expect(minimalPairQuiz(drill, 0)).toEqual([]);
    expect(minimalPairQuiz(drill, -2)).toEqual([]);
  });
});

describe('estimateSkills with drill attempts', () => {
  const at = (d: number) => new Date(Date.UTC(2026, 0, d, 10)).toISOString();
  const attempt = (p: Partial<Attempt> & { score: number }): Attempt => ({
    exerciseId: 'ue-u-word-0', unitId: drillUnitId('ue-u'), level: 'A1', skill: 'speaking', variety: 'de', grammar: [], at: at(1), ...p,
  });
  it('uses the pron- unit prefix', () => {
    expect(drillUnitId('ue-u')).toBe('pron-ue-u');
  });
  it('counts drill attempts towards speaking', () => {
    const list = Array.from({ length: 6 }, (_, i) => attempt({ exerciseId: `ue-u-w${i}`, score: 0.9 }));
    const est = estimateSkills(list);
    const speaking = est.find((e) => e.skill === 'speaking')!;
    expect(speaking).toMatchObject({ band: 'A2', attempts: 6 });
    expect(speaking.confidence).toBeGreaterThan(0);
    expect(est.find((e) => e.skill === 'grammar')!.attempts).toBe(0);
    expect(est.find((e) => e.skill === 'swiss')!.attempts).toBe(0);
  });
  it('mixes drill and unit speaking attempts, and Swiss drills feed the swiss estimate', () => {
    const list = [
      ...Array.from({ length: 4 }, (_, i) => attempt({ exerciseId: `d${i}`, score: 0.5 })),
      ...Array.from({ length: 4 }, (_, i) => attempt({ exerciseId: `u${i}`, unitId: 'a1-u01', score: 0.5 })),
      attempt({ exerciseId: 'ch-1', unitId: drillUnitId('swiss-ch'), variety: 'gsw-zh', score: 1 }),
    ];
    const est = estimateSkills(list);
    expect(est.find((e) => e.skill === 'speaking')!.attempts).toBe(9);
    expect(est.find((e) => e.skill === 'swiss')).toMatchObject({ attempts: 1, band: 'A2' });
  });
  it('is not confused by quiz attempts logged as listening', () => {
    const est = estimateSkills([attempt({ skill: 'listening', score: 1 })]);
    expect(est.find((e) => e.skill === 'listening')!.attempts).toBe(1);
    expect(est.find((e) => e.skill === 'speaking')!.attempts).toBe(0);
  });
});

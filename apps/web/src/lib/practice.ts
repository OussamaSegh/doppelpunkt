// Practice-session bookkeeping for the exercise runner and its summary screen.
import type { CompiledUnit, Exercise, Skill, VocabItem } from '@doppelpunkt/content-schema';
import type { ExerciseOutcome } from '../exercise/types';

/** First and latest outcome per item. The session score always uses the first attempt. */
export type SessionEntry = { first: ExerciseOutcome; last: ExerciseOutcome; tries: number };
export type Session = Record<string, SessionEntry>;

export function recordOutcome(session: Session, o: ExerciseOutcome): Session {
  const cur = session[o.exerciseId];
  return { ...session, [o.exerciseId]: cur ? { ...cur, last: o, tries: cur.tries + 1 } : { first: o, last: o, tries: 1 } };
}

export type SessionStats = {
  answered: number;
  total: number;
  /** Mean first-attempt score over answered items, 0..1. */
  score: number;
  rightFirstTime: number;
  perSkill: Array<{ skill: Skill; items: number; score: number }>;
  mistakes: Exercise[];
};

export function sessionStats(exercises: Exercise[], session: Session): SessionStats {
  const answered = exercises.filter((e) => session[e.id]);
  const firsts = answered.map((e) => session[e.id]!.first);
  const score = firsts.length ? firsts.reduce((a, o) => a + o.score, 0) / firsts.length : 0;
  const bySkill = new Map<Skill, { sum: number; n: number }>();
  for (const e of answered) {
    const s = bySkill.get(e.skill) ?? { sum: 0, n: 0 };
    s.sum += session[e.id]!.first.score;
    s.n++;
    bySkill.set(e.skill, s);
  }
  return {
    answered: answered.length,
    total: exercises.length,
    score,
    rightFirstTime: firsts.filter((o) => o.correct).length,
    perSkill: [...bySkill].map(([skill, v]) => ({ skill, items: v.n, score: v.sum / v.n })),
    mistakes: answered.filter((e) => !session[e.id]!.first.correct),
  };
}

const ARTICLES = new Set(['der', 'die', 'das', 'de', 'd', 's', 'en', 'e', 'es']);

function words(s: string): string[] {
  return s
    .normalize('NFC')
    .toLocaleLowerCase('de-CH')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** All German text an exercise shows or expects. */
function exerciseText(ex: Exercise): string[] {
  switch (ex.type) {
    case 'mcq':
      return [ex.question ?? '', ex.options[ex.answer] ?? ''];
    case 'gap':
      return [ex.text, ...ex.answers.map((a) => a[0] ?? '')];
    case 'order':
      return [...ex.tokens, ex.answers[0] ?? ''];
    case 'match':
      return ex.pairs.flat();
    case 'dictation':
      return [ex.transcript];
    case 'translate':
    case 'transform':
      return [ex.source, ex.answers[0] ?? ''];
    case 'speak':
      return [ex.target];
    case 'write':
    case 'roleplay':
      return [ex.model];
  }
}

function forms(v: VocabItem): string[] {
  return [v.de, v.chStd, ...(v.gswZh?.split(' / ') ?? []), ...(v.gswBe?.split(' / ') ?? [])].filter((x): x is string => !!x);
}

/** Unit words that appear in the given exercises (so the learner can add the ones they missed to review). */
export function wordsInExercises(unit: CompiledUnit, exercises: Exercise[]): VocabItem[] {
  if (!exercises.length) return [];
  const text = exercises.flatMap(exerciseText).map((t) => ` ${words(t).join(' ')} `).join('|');
  const tokens = new Set(words(text));
  return unit.vocab.filter((v) =>
    forms(v).some((f) => {
      const w = words(f).filter((x, i, all) => !(i === 0 && all.length > 1 && ARTICLES.has(x)));
      if (!w.length) return false;
      return w.length === 1 ? tokens.has(w[0]!) : text.includes(` ${w.join(' ')} `);
    }),
  );
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

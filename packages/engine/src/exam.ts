// Mock exam scoring. Closed items are graded deterministically with grade(); open items
// (write, speak, roleplay) take a 0..1 score from AI feedback or the learner's self-assessment.
import type { Exercise, ExamSection, MockExam } from '@doppelpunkt/content-schema';
import { grade, type Answer, type GradeResult } from './grade';
import { gradeSpeech } from './speech';

/** Exercise types scored by AI or self-assessment in an exam (openScores), never by grade() alone. */
export const OPEN_EXAM_TYPES = ['write', 'speak', 'roleplay'] as const;
export const isOpenExamItem = (ex: Exercise) => (OPEN_EXAM_TYPES as readonly string[]).includes(ex.type);

export type ExamItemScore = {
  id: string;
  /** Section the item belongs to. */
  section: string;
  /** grade() result for closed items (and for a speak item with a transcript but no open score); null when unanswered or open. */
  result: GradeResult | null;
  points: number;
  max: number;
};

export type ExamSectionScore = { id: string; skill: ExamSection['skill']; points: number; max: number; ratio: number };

export type ExamScore = {
  total: number;
  max: number;
  /** total / max (0 when the exam has no points). */
  ratio: number;
  /** ratio >= exam.passMark. */
  passed: boolean;
  sections: ExamSectionScore[];
  items: ExamItemScore[];
};

/** Points per exercise of a section (section.points, default 1 each). */
export function sectionPoints(section: ExamSection): number[] {
  return section.exercises.map((_, i) => section.points?.[i] ?? 1);
}

/** Maximum points of an exam. */
export function examMaxPoints(exam: MockExam): number {
  return round(exam.sections.reduce((n, s) => n + sectionPoints(s).reduce((a, b) => a + b, 0), 0));
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const answered = (a: Answer | undefined): a is Answer =>
  a !== undefined && a !== null && !(typeof a === 'string' && !a.trim()) && !(Array.isArray(a) && a.length === 0);

/**
 * Score a mock exam.
 * - Closed items: grade(); points = max × score (so a gap item with 2 of 3 gaps right earns 2/3,
 *   a near miss earns ALMOST_SCORE). Unanswered items earn 0 with result null.
 * - write / speak / roleplay: points = max × openScores[id] (clamped to 0..1). A speak item
 *   without an open score but with a transcript answer is graded with gradeSpeech.
 * - A closed item that grade() cannot judge (an unknown translation, needsAi) uses openScores[id]
 *   when one is given.
 */
export function scoreExam(
  exam: MockExam,
  answers: Record<string, Answer>,
  openScores: Record<string, number> = {},
): ExamScore {
  const items: ExamItemScore[] = [];
  const sections: ExamSectionScore[] = exam.sections.map((s) => {
    const pts = sectionPoints(s);
    let points = 0;
    let max = 0;
    s.exercises.forEach((ex, i) => {
      const itemMax = pts[i]!;
      const answer = answers[ex.id];
      const open = openScores[ex.id];
      let result: GradeResult | null = null;
      let ratio = 0;
      if (isOpenExamItem(ex)) {
        if (open !== undefined) ratio = clamp01(open);
        else if (ex.type === 'speak' && answered(answer)) {
          result = gradeSpeech(ex.target, typeof answer === 'string' ? answer : String(answer), { variety: ex.variety });
          ratio = result.score;
        }
      } else if (answered(answer)) {
        result = grade(ex, answer);
        ratio = result.needsAi && open !== undefined ? clamp01(open) : result.correct ? 1 : clamp01(result.score);
      }
      const p = round(itemMax * ratio);
      items.push({ id: ex.id, section: s.id, result, points: p, max: itemMax });
      points += p;
      max += itemMax;
    });
    return { id: s.id, skill: s.skill, points: round(points), max: round(max), ratio: max ? points / max : 0 };
  });
  const total = round(sections.reduce((n, s) => n + s.points, 0));
  const max = round(sections.reduce((n, s) => n + s.max, 0));
  const ratio = max ? total / max : 0;
  return { total, max, ratio, passed: max > 0 && ratio >= exam.passMark - 1e-9, sections, items };
}

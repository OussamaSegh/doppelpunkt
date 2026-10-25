import type { CompiledUnit, Exercise, ExerciseType } from '@doppelpunkt/content-schema';
import type { Answer } from '@doppelpunkt/engine';
import type { ResultTone } from '../lib/feedback';

export type ExerciseOf<T extends ExerciseType> = Extract<Exercise, { type: T }>;

/** Props shared by every answer input. `onChange(undefined)` means "not complete yet". */
export type InputProps<T extends ExerciseType> = {
  ex: ExerciseOf<T>;
  unit: CompiledUnit;
  disabled: boolean;
  onChange: (answer: Answer | undefined) => void;
};

export type ExerciseOutcome = {
  exerciseId: string;
  score: number;
  correct: boolean;
  /** Set by graded closed types; open types derive it from the score. */
  tone?: ResultTone;
};

/** Builds the engine answer for a word-order exercise from the tapped tokens. */
export function orderAnswer(tokens: string[]): Answer {
  return tokens;
}

/** A readable version of an answer, for diffs and AI explanations. */
export function answerText(ex: Exercise, answer: Answer): string {
  if (ex.type === 'mcq' && typeof answer === 'number') return ex.options[answer] ?? String(answer);
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (ex.type === 'gap' && Array.isArray(answer)) {
    const parts = ex.text.split('___');
    return parts.map((p, i) => p + (i < parts.length - 1 ? String((answer as string[])[i] ?? '') : '')).join('');
  }
  if (Array.isArray(answer)) {
    return answer.map((a) => (Array.isArray(a) ? `${a[0]} = ${a[1]}` : a)).join(ex.type === 'order' ? ' ' : '; ');
  }
  return '';
}

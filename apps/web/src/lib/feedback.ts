// How an answer "feels": the result tone shown in the player and the matching vibration.
import { ALMOST_SCORE, type GradeResult } from '@doppelpunkt/engine';

export type ResultTone = 'right' | 'almost' | 'wrong';

/**
 * right: accepted. almost: a near miss (one typo per word, an adjacent swap); the engine scores
 * these at ALMOST_SCORE and starts the hint with "Almost!". wrong: anything else, including
 * partly right answers (e.g. one gap of two).
 */
export function resultTone(r: Pick<GradeResult, 'correct' | 'score' | 'feedback'>): ResultTone {
  if (r.correct) return 'right';
  if (r.score >= ALMOST_SCORE || r.feedback.some((f) => /^Almost\b/.test(f))) return 'almost';
  return 'wrong';
}

export function toneOfScore(score: number, correct: boolean): ResultTone {
  if (correct) return 'right';
  return score >= ALMOST_SCORE ? 'almost' : 'wrong';
}

const PATTERNS: Record<ResultTone, number[]> = {
  right: [25],
  almost: [20, 60, 20],
  wrong: [70, 50, 70],
};

export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Vibrates for an answer when the device can, the learner has haptics on and doesn't prefer reduced motion. */
export function haptic(tone: ResultTone, enabled: boolean): boolean {
  if (!enabled || prefersReducedMotion()) return false;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(PATTERNS[tone]);
  } catch {
    return false;
  }
}

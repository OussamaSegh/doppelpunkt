// Placement test helpers: sections per level and a plain-English account of engine.placeLearner.
import { LEVELS, type Level } from '@doppelpunkt/content-schema';
import { MASTERED_SCORE, PASS_SCORE } from '@doppelpunkt/engine';

/** Items in the full test; about 50 seconds each gives the ~25 minutes the roadmap asks for. */
export const PLACEMENT_ITEMS = 30;
export const SECONDS_PER_ITEM = 50;

export type LevelScore = { level: Level; score: number; items: number };

/** Mean score per level, lowest level first. */
export function levelScores(results: Array<{ level: Level; score: number }>): LevelScore[] {
  return LEVELS.flatMap((level) => {
    const rs = results.filter((r) => r.level === level);
    if (!rs.length) return [];
    return [{ level, items: rs.length, score: rs.reduce((a, r) => a + Math.max(0, Math.min(1, r.score)), 0) / rs.length }];
  });
}

export type LevelVerdict = 'mastered' | 'passed' | 'not passed' | 'not counted';

/** How each tested level counts under the placement rule (the walk stops at the first level below the pass mark). */
export function verdicts(scores: LevelScore[]): Array<LevelScore & { verdict: LevelVerdict }> {
  let stopped = false;
  return scores.map((s) => {
    if (stopped) return { ...s, verdict: 'not counted' as const };
    if (s.score < PASS_SCORE) {
      stopped = true;
      return { ...s, verdict: 'not passed' as const };
    }
    return { ...s, verdict: s.score >= MASTERED_SCORE ? ('mastered' as const) : ('passed' as const) };
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Plain-English sentences explaining where the learner starts and why. */
export function explainPlacement(
  scores: LevelScore[],
  placed: { level: Level; unit: number },
  unitsPerLevel: Partial<Record<Level, number>>,
): string[] {
  const v = verdicts(scores);
  const out: string[] = [];
  const passedLevels = v.filter((s) => s.verdict === 'mastered' || s.verdict === 'passed');
  const failed = v.find((s) => s.verdict === 'not passed');
  const top = passedLevels[passedLevels.length - 1];
  const pass = pct(PASS_SCORE);
  const mastered = pct(MASTERED_SCORE);

  if (!scores.length) {
    out.push("You didn't answer any questions, so you start at the beginning: A1, unit 1.");
    return out;
  }
  if (!top) {
    const first = v[0]!;
    out.push(`You scored ${pct(first.score)} on the ${first.level} questions. A level counts as passed at ${pass}, so you start at the beginning: A1, unit 1.`);
    out.push("That's a good place to be: the first units go quickly when some of it is familiar.");
    return out;
  }
  if (passedLevels.length > 1) {
    out.push(`You passed ${passedLevels.map((s) => `${s.level} (${pct(s.score)})`).join(', ')}.`);
  }
  if (top.verdict === 'mastered') {
    const next = LEVELS[LEVELS.indexOf(top.level) + 1];
    if (placed.level !== top.level) {
      out.push(`You scored ${pct(top.score)} on ${top.level}. ${mastered} or more means you've mastered it, so you start at the next level: ${placed.level}, unit 1.`);
    } else {
      out.push(
        `You scored ${pct(top.score)} on ${top.level}, which means you've mastered it. ${next ? `${next} lessons aren't available yet, so` : 'So'} you start at the last ${top.level} unit (unit ${placed.unit}).`,
      );
    }
  } else {
    out.push(
      `You passed ${top.level} with ${pct(top.score)}. Between ${pass} and ${mastered} you skip ahead in proportion — the closer to ${mastered}, the further in — which puts you at unit ${placed.unit}${
        unitsPerLevel[top.level] ? ` of ${unitsPerLevel[top.level]}` : ''
      }.`,
    );
  }
  if (failed) {
    out.push(`On ${failed.level} you scored ${pct(failed.score)}, below the ${pass} pass mark, so higher levels don't count yet.`);
  }
  out.push('Earlier units stay open: skim them whenever something feels new.');
  return out;
}

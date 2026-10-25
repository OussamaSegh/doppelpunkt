// Pronunciation drills: minimal-pair discrimination quiz and the attempt ids used for progress.
import type { PronunciationDrill } from '@doppelpunkt/content-schema';

/** Attempts from a drill use unitId `pron-<drill id>` and skill 'speaking' (or 'listening' for the quiz). */
export const DRILL_UNIT_PREFIX = 'pron-';
export const drillUnitId = (drillId: string) => `${DRILL_UNIT_PREFIX}${drillId}`;

type Word = PronunciationDrill['words'][number];

/** One "which word did you hear?" item. Play `play` (audio or TTS), show `options`; `answer` is the index of `play` in `options`. */
export type MinimalPairItem = {
  /** Stable id: `<drill id>-mp-<pair index>-<a|b>`. */
  id: string;
  /** Index into drill.pairs. */
  pair: number;
  play: Word;
  options: [Word, Word];
  answer: 0 | 1;
};

/** Small deterministic PRNG (mulberry32) seeded by a number or a string. */
function rng(seed: number | string): () => number {
  let h = typeof seed === 'number' ? seed >>> 0 : 2166136261;
  if (typeof seed === 'string') {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * `n` shuffled discrimination items from the drill's minimal pairs. Each pair is used once per
 * round (both of its words are played before a pair repeats with the same word); consecutive
 * items avoid the same pair where possible. Deterministic for a given seed. Empty when the drill
 * has no pairs.
 */
export function minimalPairQuiz(drill: Pick<PronunciationDrill, 'id' | 'pairs'>, n: number, seed: number | string = 0): MinimalPairItem[] {
  const pairs = drill.pairs;
  const count = Math.max(0, Math.floor(n));
  if (!pairs.length || !count) return [];
  const rand = rng(seed);
  // Pool of (pair, side) slots; refilled in shuffled rounds.
  let pool: Array<[number, 0 | 1]> = [];
  const out: MinimalPairItem[] = [];
  while (out.length < count) {
    if (!pool.length) pool = shuffle(pairs.flatMap((_, i): Array<[number, 0 | 1]> => [[i, 0], [i, 1]]), rand);
    const prev = out[out.length - 1]?.pair;
    let at = pool.findIndex(([p]) => p !== prev);
    if (at < 0) at = 0;
    const [p, side] = pool.splice(at, 1)[0]!;
    const pair = pairs[p]!;
    const play = pair[side];
    const flip = rand() < 0.5;
    const options: [Word, Word] = flip ? [pair[1], pair[0]] : [pair[0], pair[1]];
    const answer: 0 | 1 = options[0] === play ? 0 : 1;
    out.push({ id: `${drill.id}-mp-${p}-${side === 0 ? 'a' : 'b'}`, pair: p, play, options, answer });
  }
  return out;
}

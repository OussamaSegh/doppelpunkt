// Placement test: sample closed items across levels, then place the learner.
import { LEVELS, SKILLS, type Exercise, type Level, type LevelPack } from '@doppelpunkt/content-schema';

/** Exercise types used for placement: closed, objective, and need neither audio nor a microphone to answer. */
export const PLACEMENT_TYPES: ReadonlyArray<Exercise['type']> = ['mcq', 'gap', 'order', 'match'];
/** A level counts as passed at this mean score. */
export const PASS_SCORE = 0.7;
/** At or above this mean score the level counts as mastered and the learner moves up a level. */
export const MASTERED_SCORE = 0.9;

export type PlacementItem = Exercise & { level: Level; unitId: string };

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Pick about `n` placement items (default 20), spread evenly over the levels present in `packs`
 * and, within a level, round-robin over skills. Only Standard German (de / ch-std) closed items
 * are used. Items come back ordered from the lowest level to the highest, each tagged with its
 * `level` and `unitId`. Deterministic for a given `seed`.
 */
export function placementItems(packs: LevelPack[], n = 20, seed = 1): PlacementItem[] {
  const rand = rng(seed);
  const byLevel = new Map<Level, PlacementItem[]>();
  for (const pack of packs) {
    for (const unit of pack.units) {
      for (const ex of unit.exercises) {
        if (!PLACEMENT_TYPES.includes(ex.type)) continue;
        if (ex.variety !== 'de' && ex.variety !== 'ch-std') continue;
        const list = byLevel.get(pack.level) ?? [];
        list.push({ ...ex, level: pack.level, unitId: unit.id });
        byLevel.set(pack.level, list);
      }
    }
  }
  const levels = LEVELS.filter((l) => byLevel.has(l));
  if (!levels.length || n <= 0) return [];
  const out: PlacementItem[] = [];
  levels.forEach((level, li) => {
    // Distribute n over levels; earlier levels take the remainder.
    const quota = Math.floor(n / levels.length) + (li < n % levels.length ? 1 : 0);
    const buckets = SKILLS.map((s) => shuffle(byLevel.get(level)!.filter((e) => e.skill === s), rand)).filter((b) => b.length);
    const order = shuffle(buckets.map((_, i) => i), rand);
    const picked: PlacementItem[] = [];
    while (picked.length < quota && buckets.some((b) => b.length)) {
      for (const i of order) {
        const item = buckets[i]!.shift();
        if (item) picked.push(item);
        if (picked.length >= quota) break;
      }
    }
    out.push(...picked);
  });
  return out;
}

/**
 * Placement rule:
 * 1. Average the scores per level (levels without results are ignored).
 * 2. Walk up from A1. A level is passed at ≥ 70 % (PASS_SCORE); the walk stops at the first
 *    tested level that is not passed, so a lucky high level cannot skip a failed lower one.
 * 3. No level passed → A1, unit 1.
 * 4. Highest passed level L with ≥ 90 % (MASTERED_SCORE) → the next level, unit 1
 *    (if `unitsPerLevel` is given and has no units for the next level, stay at L's last unit).
 * 5. Otherwise the learner works in L and skips ahead by how secure they are:
 *    unit = 1 + floor((score − 0.7) / 0.2 × 12), clamped to 1..12 and to the units available.
 */
export function placeLearner(
  results: Array<{ level: Level; score: number }>,
  unitsPerLevel?: Partial<Record<Level, number>>,
): { level: Level; unit: number } {
  const agg = new Map<Level, { sum: number; n: number }>();
  for (const r of results) {
    const a = agg.get(r.level) ?? { sum: 0, n: 0 };
    a.sum += Math.max(0, Math.min(1, r.score));
    a.n++;
    agg.set(r.level, a);
  }
  let passed: { level: Level; score: number } | null = null;
  for (const level of LEVELS) {
    const a = agg.get(level);
    if (!a) continue;
    const score = a.sum / a.n;
    if (score < PASS_SCORE) break;
    passed = { level, score };
  }
  const maxUnit = (l: Level) => Math.max(1, Math.min(12, unitsPerLevel ? (unitsPerLevel[l] ?? 0) : 12));
  if (!passed) return { level: 'A1', unit: 1 };
  const idx = LEVELS.indexOf(passed.level);
  const next = LEVELS[idx + 1];
  if (passed.score >= MASTERED_SCORE) {
    if (next && (!unitsPerLevel || (unitsPerLevel[next] ?? 0) > 0)) return { level: next, unit: 1 };
    return { level: passed.level, unit: maxUnit(passed.level) };
  }
  const unit = 1 + Math.floor(((passed.score - PASS_SCORE) / (MASTERED_SCORE - PASS_SCORE)) * 12);
  return { level: passed.level, unit: Math.max(1, Math.min(unit, maxUnit(passed.level))) };
}

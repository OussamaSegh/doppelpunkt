// Learner progress: CEFR band estimates, error profile, unit progress, streaks and study time.
import { LEVELS, SKILLS, type CompiledUnit, type Level, type Skill, type Variety } from '@doppelpunkt/content-schema';

export type Attempt = {
  exerciseId: string;
  unitId: string;
  level: Level;
  skill: Skill;
  variety: Variety;
  /** 0..1 */
  score: number;
  grammar: string[];
  errorTypes?: string[];
  /** ISO date-time */
  at: string;
};

export type SkillEstimate = {
  skill: Skill | 'swiss';
  /** Working level: 'A1' = early A1, 'A1+' = upper A1, 'A2' = A1 secure and working at A2 ... 'C2'. */
  band: string;
  /** 0..1, grows with the number of attempts. */
  confidence: number;
  attempts: number;
};

/** Half-life (days) of the recency weight. An attempt 30 days older counts half as much. */
export const RECENCY_HALF_LIFE_DAYS = 30;
/** Mean weighted score at which a level counts as secure. */
export const MASTERY_THRESHOLD = 0.8;
const DAY = 86_400_000;

const isSwiss = (v: Variety) => v === 'gsw-zh' || v === 'gsw-be';

function bandFor(attempts: Attempt[], now: number): string {
  const byLevel = new Map<Level, { w: number; s: number }>();
  for (const a of attempts) {
    const age = Math.max(0, (now - Date.parse(a.at)) / DAY);
    const w = Math.pow(0.5, age / RECENCY_HALF_LIFE_DAYS);
    const acc = byLevel.get(a.level) ?? { w: 0, s: 0 };
    acc.w += w;
    acc.s += w * Math.max(0, Math.min(1, a.score));
    byLevel.set(a.level, acc);
  }
  // Walk up the levels: each secure level adds 1; the first insecure level adds a fraction and stops.
  let value = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const acc = byLevel.get(LEVELS[i]!);
    if (!acc || acc.w === 0) break;
    const mastery = acc.s / acc.w;
    if (mastery >= MASTERY_THRESHOLD) value = i + 1;
    else {
      value = i + mastery / MASTERY_THRESHOLD;
      break;
    }
  }
  const idx = Math.min(LEVELS.length - 1, Math.floor(value));
  const frac = value - idx;
  return LEVELS[idx]! + (value < LEVELS.length && frac >= 0.5 ? '+' : '');
}

/**
 * Estimate a CEFR band per skill, plus 'swiss' (all gsw-zh / gsw-be attempts).
 * Always returns all six skills followed by 'swiss'. `now` defaults to the latest attempt time,
 * which keeps the result deterministic.
 */
export function estimateSkills(attempts: Attempt[], now?: Date): SkillEstimate[] {
  const t = now?.getTime() ?? attempts.reduce((m, a) => Math.max(m, Date.parse(a.at) || 0), 0);
  const groups: Array<[Skill | 'swiss', Attempt[]]> = [
    ...SKILLS.map((s): [Skill, Attempt[]] => [s, attempts.filter((a) => a.skill === s)]),
    ['swiss', attempts.filter((a) => isSwiss(a.variety))],
  ];
  return groups.map(([skill, list]) => ({
    skill,
    band: list.length ? bandFor(list, t) : 'A1',
    confidence: Math.round((1 - Math.exp(-list.length / 10)) * 100) / 100,
    attempts: list.length,
  }));
}

/**
 * Weak spots: grammar ids and error types, each weighted by how badly the attempt failed
 * (weight = 1 - score; perfect attempts count 0). Sorted by count, highest first.
 */
export function errorProfile(attempts: Attempt[]): Array<{ key: string; count: number; kind: 'grammar' | 'error' }> {
  const m = new Map<string, { key: string; count: number; kind: 'grammar' | 'error' }>();
  const add = (key: string, kind: 'grammar' | 'error', w: number) => {
    const id = `${kind}:${key}`;
    const e = m.get(id) ?? { key, count: 0, kind };
    e.count += w;
    m.set(id, e);
  };
  for (const a of attempts) {
    const w = 1 - Math.max(0, Math.min(1, a.score));
    if (w <= 0) continue;
    for (const g of new Set(a.grammar)) add(g, 'grammar', w);
    for (const e of new Set(a.errorTypes ?? [])) add(e, 'error', w);
  }
  return [...m.values()]
    .map((e) => ({ ...e, count: Math.round(e.count * 100) / 100 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** done = exercises with at least one attempt; avgScore = mean of the latest score per attempted exercise. */
export function unitProgress(unit: CompiledUnit, attempts: Attempt[]): { done: number; total: number; avgScore: number } {
  const ids = new Set(unit.exercises.map((e) => e.id));
  const latest = new Map<string, Attempt>();
  for (const a of attempts) {
    if (!ids.has(a.exerciseId)) continue;
    if (a.unitId && a.unitId !== unit.id) continue;
    const prev = latest.get(a.exerciseId);
    if (!prev || Date.parse(a.at) >= Date.parse(prev.at)) latest.set(a.exerciseId, a);
  }
  const scores = [...latest.values()].map((a) => a.score);
  return {
    done: latest.size,
    total: ids.size,
    avgScore: scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : 0,
  };
}

/** Local calendar day key (YYYY-MM-DD). Bare 'YYYY-MM-DD' strings are taken as is. */
export function dayKey(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const x = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

function shiftDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
  return x;
}

/**
 * Current streak in days: consecutive study days ending today, or yesterday if the learner has
 * not studied yet today (the streak is still alive). 0 if neither.
 */
export function streak(dates: Array<Date | string>, today: Date = new Date()): number {
  const days = new Set(dates.map(dayKey));
  let cursor = days.has(dayKey(today)) ? today : shiftDays(today, -1);
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor = shiftDays(cursor, -1);
  }
  return n;
}

/** Longest run of consecutive study days. */
export function longestStreak(dates: Array<Date | string>): number {
  const days = [...new Set(dates.map(dayKey))].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of days) {
    const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
    const expectedPrev = dayKey(shiftDays(new Date(y, m - 1, dd, 12), -1));
    run = prev === expectedPrev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Minutes studied on each of the last 7 local days, oldest first, ending with today. */
export function weeklyMinutes(
  sessions: Array<{ at: string; minutes: number }>,
  today: Date = new Date(),
): Array<{ date: string; minutes: number }> {
  const out = Array.from({ length: 7 }, (_, i) => ({ date: dayKey(shiftDays(today, i - 6)), minutes: 0 }));
  const index = new Map(out.map((d, i) => [d.date, i]));
  for (const s of sessions) {
    const i = index.get(dayKey(s.at));
    if (i !== undefined) out[i]!.minutes += Math.max(0, s.minutes);
  }
  return out;
}

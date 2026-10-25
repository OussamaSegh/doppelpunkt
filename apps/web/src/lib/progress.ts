// Writes learner progress (attempts, unit status, review cards) and derives streaks.
import type { CompiledUnit, Exercise } from '@doppelpunkt/content-schema';
import { newCard, streak, weeklyMinutes } from '@doppelpunkt/engine';
import { db, type ActivityRow, type AttemptRow } from '../db';
import { noteAttempt } from './beta/stats';

export async function recordAttempt(
  ex: Exercise,
  unit: CompiledUnit,
  score: number,
  errorTypes?: string[],
): Promise<void> {
  const row: AttemptRow = {
    exerciseId: ex.id,
    unitId: unit.id,
    level: unit.level,
    // Speaking items always count as speaking (so they feed the radar), whatever the item's tag.
    skill: ex.type === 'speak' ? 'speaking' : ex.skill,
    variety: ex.variety,
    score: Math.max(0, Math.min(1, score)),
    grammar: ex.grammar,
    at: new Date().toISOString(),
    ...(errorTypes?.length ? { errorTypes } : {}),
  };
  await db.attempts.add(row);
  await noteAttempt(ex.id, row.score);
  await touchUnit(unit);
}

async function touchUnit(unit: Pick<CompiledUnit, 'id' | 'canDo'>, visited?: string): Promise<void> {
  await db.transaction('rw', db.unitStatus, async () => {
    const cur = await db.unitStatus.get(unit.id);
    const canDo = cur?.canDo ?? unit.canDo.map(() => false);
    const steps = new Set(cur?.visited ?? []);
    if (visited) steps.add(visited);
    await db.unitStatus.put({
      unitId: unit.id,
      startedAt: cur?.startedAt ?? new Date().toISOString(),
      ...(cur?.completedAt ? { completedAt: cur.completedAt } : {}),
      visited: [...steps],
      canDo,
    });
  });
}

export function markVisited(unit: CompiledUnit, step: string): Promise<void> {
  return touchUnit(unit, step);
}

export async function setCanDo(unit: CompiledUnit, index: number, value: boolean): Promise<void> {
  await touchUnit(unit);
  await db.unitStatus.where('unitId').equals(unit.id).modify((row) => {
    const next = unit.canDo.map((_, i) => row.canDo[i] ?? false);
    next[index] = value;
    row.canDo = next;
  });
}

export async function setUnitComplete(unit: CompiledUnit, done: boolean): Promise<void> {
  await touchUnit(unit);
  await db.unitStatus.where('unitId').equals(unit.id).modify((row) => {
    if (done) row.completedAt = new Date().toISOString();
    else delete row.completedAt;
  });
}

/** Adds the unit's vocabulary to the review deck (existing cards keep their schedule). */
export async function addUnitVocab(unit: CompiledUnit, now = new Date()): Promise<number> {
  return addVocab(unit, unit.vocab.map((v) => v.id), now);
}

/** Adds some of the unit's words to the review deck; returns how many were new. */
export async function addVocab(unit: CompiledUnit, ids: string[], now = new Date()): Promise<number> {
  const wanted = new Set(ids);
  const existing = new Set((await db.cards.bulkGet([...wanted])).filter(Boolean).map((c) => c!.id));
  const fresh = unit.vocab.filter((v) => wanted.has(v.id) && !existing.has(v.id));
  await db.cards.bulkPut(fresh.map((v) => ({ ...newCard(v.id, now), unitId: unit.id, addedAt: now.toISOString() })));
  return fresh.length;
}

/** Consecutive study days (activity or answered exercises), ending today or yesterday. */
export function studyStreak(activity: ActivityRow[], attempts: Pick<AttemptRow, 'at'>[], now = new Date()): number {
  return streak([...activity.filter((a) => a.seconds > 0).map((a) => a.day), ...attempts.map((a) => a.at)], now);
}

/** Minutes per day for the last 7 days, oldest first, with short weekday labels. */
export function weekMinutes(activity: ActivityRow[], now = new Date()): Array<{ day: string; label: string; minutes: number }> {
  return weeklyMinutes(activity.map((a) => ({ at: a.day, minutes: a.seconds / 60 })), now).map((d) => {
    const [y, m, day] = d.date.split('-').map(Number);
    return {
      day: d.date,
      label: new Date(y ?? 0, (m ?? 1) - 1, day ?? 1).toLocaleDateString('en', { weekday: 'short' }),
      minutes: Math.round(d.minutes),
    };
  });
}

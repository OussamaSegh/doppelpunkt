// The level's can-do checklist: every unit's canDo statements, ticked automatically when the unit
// check is passed, or by hand; plus the "A1 complete" milestone.
import type { CompiledUnit, LevelPack } from '@doppelpunkt/content-schema';
import { unitProgress, type Attempt } from '@doppelpunkt/engine';
import type { UnitStatusRow } from '../db';

/** Units per CEFR level in the syllabus (docs/CURRICULUM.md). */
export const UNITS_PER_LEVEL = 12;
/** Share of a unit's exercises that must be answered for its check to count. */
export const CHECK_COVERAGE = 0.8;
/** Average score (latest attempt per exercise) needed to pass the unit check. */
export const CHECK_PASS_SCORE = 0.6;

export type UnitCheck = { done: number; total: number; avgScore: number; completed: boolean; passed: boolean };

/**
 * A unit check is passed when the learner marked the unit as done, answered at least 80% of its
 * exercises, and averages at least 60% on them.
 */
export function unitCheck(unit: CompiledUnit, attempts: Attempt[], status?: UnitStatusRow): UnitCheck {
  const p = unitProgress(unit, attempts);
  const completed = !!status?.completedAt;
  const covered = p.total > 0 && p.done >= Math.ceil(p.total * CHECK_COVERAGE);
  return { ...p, completed, passed: completed && covered && p.avgScore >= CHECK_PASS_SCORE };
}

export type CanDoItem = {
  unit: CompiledUnit;
  index: number;
  text: string;
  /** Ticked by hand on the unit's Check step or on Progress. */
  manual: boolean;
  /** Ticked because the unit check is passed. */
  auto: boolean;
  done: boolean;
};

export type CanDoUnit = { unit: CompiledUnit; check: UnitCheck; items: CanDoItem[] };

export function canDoChecklist(pack: LevelPack, attempts: Attempt[], statuses: UnitStatusRow[]): CanDoUnit[] {
  return [...pack.units]
    .sort((a, b) => a.number - b.number)
    .map((unit) => {
      const status = statuses.find((s) => s.unitId === unit.id);
      const check = unitCheck(unit, attempts, status);
      const items = unit.canDo.map((text, index): CanDoItem => {
        const manual = status?.canDo[index] ?? false;
        return { unit, index, text, manual, auto: check.passed, done: manual || check.passed };
      });
      return { unit, check, items };
    });
}

export type Milestone = {
  /** Units of the level in the installed pack. */
  units: number;
  unitsDone: number;
  /** true when all 12 units exist in the pack and are marked done. */
  allUnitsDone: boolean;
  examPassed: boolean;
  /** true when the pack has at least one mock exam. */
  hasExam: boolean;
  canDoDone: number;
  canDoTotal: number;
  complete: boolean;
};

/** "A1 complete": all 12 units marked as done and a mock exam of the level passed. */
export function levelMilestone(pack: LevelPack, statuses: UnitStatusRow[], checklist: CanDoUnit[], examPassed: boolean): Milestone {
  const unitsDone = pack.units.filter((u) => statuses.some((s) => s.unitId === u.id && s.completedAt)).length;
  const allUnitsDone = pack.units.length >= UNITS_PER_LEVEL && unitsDone >= UNITS_PER_LEVEL && unitsDone === pack.units.length;
  const items = checklist.flatMap((u) => u.items);
  return {
    units: pack.units.length,
    unitsDone,
    allUnitsDone,
    examPassed,
    hasExam: pack.exams.length > 0,
    canDoDone: items.filter((i) => i.done).length,
    canDoTotal: items.length,
    complete: allUnitsDone && examPassed,
  };
}

// Mock exam helpers: points per item, scoring, time, plain-English verdicts and what to practise.
import type { CompiledUnit, ExamSection, Level, LevelPack, MockExam } from '@doppelpunkt/content-schema';
import { sectionPoints } from '@doppelpunkt/engine';
import { VARIETY_META } from './varieties';


export const FORMAT_NAME: Record<MockExam['format'], string> = {
  goethe: 'Goethe-Zertifikat',
  telc: 'telc Deutsch',
  osd: 'ÖSD Zertifikat',
  generic: 'standard',
};

export const SKILL_NAME: Record<ExamSection['skill'], { de: string; en: string }> = {
  listening: { de: 'Hören', en: 'Listening' },
  reading: { de: 'Lesen', en: 'Reading' },
  writing: { de: 'Schreiben', en: 'Writing' },
  speaking: { de: 'Sprechen', en: 'Speaking' },
};

export function examMinutes(exam: MockExam): number {
  return exam.sections.reduce((a, s) => a + s.minutes, 0);
}

export function sectionMax(section: ExamSection): number {
  return sectionPoints(section).reduce((a, b) => a + b, 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "You passed / didn't pass" in plain English, with the numbers that decided it. */
export function verdictText(score: { points: number; max: number; passMark: number; passed: boolean }): { headline: string; detail: string } {
  const ratio = score.max ? score.points / score.max : 0;
  const pct = Math.round(ratio * 100);
  const need = round1(score.passMark * score.max);
  const passPct = Math.round(score.passMark * 100);
  if (score.passed) {
    return {
      headline: 'You passed the mock exam.',
      detail: `You scored ${score.points} of ${score.max} points (${pct}%). The pass mark is ${passPct}% (${need} points).`,
    };
  }
  const short = Math.max(0, round1(need - score.points));
  return {
    headline: "You didn't pass this time.",
    detail: `You scored ${score.points} of ${score.max} points (${pct}%). The pass mark is ${passPct}% (${need} points), so you were ${short} point${short === 1 ? '' : 's'} short.`,
  };
}

/** m:ss for the countdown. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Spoken form for screen readers: "4 minutes 30 seconds". */
export function spokenTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [m ? `${m} minute${m === 1 ? '' : 's'}` : '', r ? `${r} second${r === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' ') || '0 seconds';
}

/** Moments the timer announces politely (seconds left), not every tick. */
export function announcement(left: number, sectionSeconds: number): string | undefined {
  if (left === 300 && sectionSeconds > 600) return '5 minutes left in this section.';
  if (left === 60 && sectionSeconds > 120) return '1 minute left in this section.';
  return undefined;
}

/**
 * The exam's items need a unit for inputs and audio. Audio paths in an exam are relative to the
 * exam folder, so the stand-in unit uses the exam id: audio resolves to packs/audio/<level>/<examId>/…
 */
export function examUnit(exam: MockExam, pack: LevelPack): CompiledUnit {
  const base = pack.units[0];
  return {
    ...(base ?? ({} as CompiledUnit)),
    id: exam.id,
    level: exam.level,
    number: base?.number ?? 1,
    title: exam.title,
    titleEn: exam.title,
    canDo: base?.canDo ?? ['—'],
    exercises: exam.sections.flatMap((s) => s.exercises),
  };
}

/** Listening stimulus: playable (recording, or TTS for de / ch-std), or shown as text when it can't be heard. */
export function stimulusPlayable(stimulus: NonNullable<ExamSection['stimulus']>): boolean {
  return !!stimulus.audio || stimulus.variety === 'de' || stimulus.variety === 'ch-std';
}

export function stimulusLang(stimulus: NonNullable<ExamSection['stimulus']>): string {
  return VARIETY_META[stimulus.variety].lang;
}

export type PracticeLink = { grammarId: string; title: string; unitId: string; lost: number };

/**
 * Grammar points behind lost points, most points lost first, linked to the unit that teaches them.
 * Items without grammar tags don't appear.
 */
export function practiseLinks(exam: MockExam, pack: LevelPack | undefined, items: Array<{ exerciseId: string; points: number; max: number }>): PracticeLink[] {
  const byId = new Map(exam.sections.flatMap((s) => s.exercises).map((e) => [e.id, e] as const));
  const lost = new Map<string, number>();
  for (const it of items) {
    const ex = byId.get(it.exerciseId);
    const miss = it.max - it.points;
    if (!ex || miss <= 0) continue;
    for (const g of ex.grammar) lost.set(g, (lost.get(g) ?? 0) + miss);
  }
  const out: PracticeLink[] = [];
  for (const [grammarId, n] of lost) {
    const unit = pack?.units.find((u) => u.grammar.some((g) => g.id === grammarId));
    const point = unit?.grammar.find((g) => g.id === grammarId);
    if (unit && point) out.push({ grammarId, title: point.title, unitId: unit.id, lost: round1(n) });
  }
  return out.sort((a, b) => b.lost - a.lost || a.title.localeCompare(b.title));
}

/** The latest result per level, newest first within the input. */
export function latestPerLevel<T extends { level: Level; at: string }>(rows: T[]): Map<Level, T> {
  const out = new Map<Level, T>();
  for (const r of rows) {
    const cur = out.get(r.level);
    if (!cur || r.at > cur.at) out.set(r.level, r);
  }
  return out;
}

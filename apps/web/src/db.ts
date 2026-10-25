// Local-first persistence (IndexedDB via Dexie). Nothing here leaves the device.
import Dexie, { type EntityTable } from 'dexie';
import type { Level } from '@doppelpunkt/content-schema';
import type { Attempt, CardState } from '@doppelpunkt/engine';
import type { ProviderId } from '@doppelpunkt/ai';

export type Dialect = 'gsw-zh' | 'gsw-be';
export type ThemePref = 'system' | 'light' | 'dark';

export type Settings = {
  key: 'app';
  onboarded: boolean;
  dialect: Dialect;
  dailyGoalMin: number;
  theme: ThemePref;
  /** Level the learner works at (set by onboarding or the placement test). */
  level: Level;
  startUnit: number;
  activeProvider?: ProviderId;
  /** Chosen model per provider (one of DEFAULT_MODELS or a custom id). */
  models: Partial<Record<ProviderId, string>>;
  /** Optional relay that forwards AI calls (services/relay). */
  relayUrl?: string;
  /** Monthly AI spend cap in USD; 0 disables AI calls. */
  monthlyCapUsd: number;
  /** Vibrate on right / almost / wrong answers where the device supports it. */
  haptics: boolean;
  /** Last placement test result, if the learner took one. */
  placement?: PlacementResult;
};

/** Saved outcome of the placement test (shown on Progress). */
export type PlacementResult = {
  at: string;
  level: Level;
  unit: number;
  /** Mean score per tested level, lowest level first. */
  perLevel: Array<{ level: Level; score: number; items: number }>;
  answered: number;
  total: number;
  durationSec: number;
  /** true when the learner stopped before the end, or the test stopped at a level below the pass mark. */
  stoppedEarly: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  onboarded: false,
  dialect: 'gsw-zh',
  dailyGoalMin: 10,
  theme: 'system',
  level: 'A1',
  startUnit: 1,
  models: {},
  monthlyCapUsd: 5,
  haptics: true,
};

export type AttemptRow = Attempt & { id?: number };

/** FSRS card for one vocab item; `id` is the vocab id. */
export type CardRow = CardState & { unitId: string; addedAt: string };

export type UnitStatusRow = {
  unitId: string;
  startedAt: string;
  completedAt?: string;
  /** Step ids the learner has opened. */
  visited: string[];
  /** Self-assessed can-do statements, same order as unit.canDo. */
  canDo: boolean[];
};

export type AiKeyRow = {
  provider: ProviderId;
  /** Output of encryptKey (AES-GCM + PBKDF2). Plaintext keys are never stored. */
  payload: string;
  createdAt: string;
};

export type UsageRow = {
  id?: number;
  at: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  purpose: 'explain' | 'writing' | 'tutor' | 'roleplay' | 'transcription' | 'other';
  estimated: boolean;
  /** Seconds of audio sent for transcription (purpose "transcription"); priced per minute, not per token. */
  audioSeconds?: number;
};

export type WritingSubmissionRow = {
  id?: number;
  exerciseId: string;
  unitId: string;
  text: string;
  at: string;
  /** AI feedback (WritingFeedback) when graded by a provider. */
  feedback?: unknown;
  /** Checked self-assessment items when no AI was used. */
  selfCheck?: boolean[];
  score: number;
};

/** How an exam item got its points. */
export type ExamItemMethod = 'auto' | 'ai' | 'self' | 'unanswered';

/** One item of a finished mock exam, enough to show the full review again later. */
export type ExamItemResult = {
  exerciseId: string;
  sectionId: string;
  points: number;
  max: number;
  /** 0..1 */
  score: number;
  method: ExamItemMethod;
  /** The learner's answer as text (closed items: readable form; open items: their text or transcript). */
  answer?: string;
  /** Engine GradeResult for closed and speaking items (solution, diff, hints). */
  result?: unknown;
  /** AI writing feedback (WritingFeedback) when graded by a provider. */
  feedback?: unknown;
  /** Self-assessment ticks, same order as the checklist / goals. */
  selfCheck?: boolean[];
};

export type ExamSectionResult = {
  sectionId: string;
  points: number;
  max: number;
  /** Seconds spent in the section (pauses excluded). */
  usedSec: number;
  /** true when the countdown ran out and the exam moved on by itself. */
  timedOut: boolean;
};

/** A finished mock exam attempt. */
export type ExamResultRow = {
  id?: number;
  examId: string;
  level: Level;
  at: string;
  points: number;
  max: number;
  passMark: number;
  passed: boolean;
  /** Active time over all sections (pauses excluded). */
  durationSec: number;
  pausedSec: number;
  sections: ExamSectionResult[];
  items: ExamItemResult[];
};

/** Seconds of active study per local day (YYYY-MM-DD). */
export type ActivityRow = { day: string; seconds: number };

export class DoppelpunktDB extends Dexie {
  settings!: EntityTable<Settings, 'key'>;
  attempts!: EntityTable<AttemptRow, 'id'>;
  cards!: EntityTable<CardRow, 'id'>;
  unitStatus!: EntityTable<UnitStatusRow, 'unitId'>;
  aiKeys!: EntityTable<AiKeyRow, 'provider'>;
  usage!: EntityTable<UsageRow, 'id'>;
  writingSubmissions!: EntityTable<WritingSubmissionRow, 'id'>;
  activity!: EntityTable<ActivityRow, 'day'>;
  examResults!: EntityTable<ExamResultRow, 'id'>;

  constructor(name = 'doppelpunkt') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      attempts: '++id, exerciseId, unitId, level, skill, at',
      cards: 'id, unitId, due',
      unitStatus: 'unitId',
      aiKeys: 'provider',
      usage: '++id, at, provider',
      writingSubmissions: '++id, exerciseId, unitId, at',
      activity: 'day',
    });
    // v0.4: mock exam results.
    this.version(2).stores({ examResults: '++id, examId, level, at' });
  }
}

export const db = new DoppelpunktDB();

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...row, models: { ...DEFAULT_SETTINGS.models, ...row?.models } };
}

export async function updateSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, key: 'app' });
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function addActivity(seconds: number, d = new Date()): Promise<void> {
  const day = todayKey(d);
  await db.transaction('rw', db.activity, async () => {
    const row = await db.activity.get(day);
    await db.activity.put({ day, seconds: (row?.seconds ?? 0) + seconds });
  });
}

const EXPORT_TABLES = ['settings', 'attempts', 'cards', 'unitStatus', 'usage', 'writingSubmissions', 'activity', 'examResults'] as const;
type ExportTable = (typeof EXPORT_TABLES)[number];

export type ProgressExport = {
  app: 'doppelpunkt';
  format: 1;
  exportedAt: string;
  tables: Record<ExportTable, unknown[]>;
};

/** Progress as JSON. Encrypted AI keys are deliberately left out. */
export async function exportProgress(): Promise<ProgressExport> {
  const tables = {} as Record<ExportTable, unknown[]>;
  for (const t of EXPORT_TABLES) tables[t] = await db.table(t).toArray();
  return { app: 'doppelpunkt', format: 1, exportedAt: new Date().toISOString(), tables };
}

export function isProgressExport(v: unknown): v is ProgressExport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.app !== 'doppelpunkt' || o.format !== 1 || typeof o.tables !== 'object' || o.tables === null) return false;
  const tables = o.tables as Record<string, unknown>;
  return EXPORT_TABLES.every((t) => tables[t] === undefined || Array.isArray(tables[t]));
}

/** Replaces local progress with an export. Keys stay untouched. */
export async function importProgress(data: ProgressExport): Promise<void> {
  const tables = EXPORT_TABLES.map((t) => db.table(t));
  await db.transaction('rw', tables, async () => {
    for (const t of EXPORT_TABLES) {
      const table = db.table(t);
      await table.clear();
      const rows = data.tables[t] ?? [];
      if (rows.length) await table.bulkPut(rows);
    }
  });
}

/** Deletes everything, including encrypted keys. */
export async function resetAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}

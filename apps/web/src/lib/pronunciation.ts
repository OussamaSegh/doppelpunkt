// Pronunciation drills: loads /packs/pronunciation.json, builds the minimal-pair quiz and records
// attempts so speaking (and listening) scores feed the skill radar.
import { create } from 'zustand';
import { PronunciationPack, type Exercise, type PronunciationDrill, type Skill } from '@doppelpunkt/content-schema';
import { db, type AttemptRow } from '../db';
import { drillUnitId as engineDrillUnitId, minimalPairQuiz, type MinimalPairItem } from '@doppelpunkt/engine';

export type PronStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type PronState = { status: PronStatus; drills: PronunciationDrill[]; error?: string };

const packsBase = (): string => `${import.meta.env.BASE_URL ?? '/'}packs/`;

/** Fetches and validates the pronunciation pack. A missing file is "empty", not an error. */
export async function loadPronunciation(fetchImpl: typeof fetch = fetch): Promise<PronState> {
  let res: Response;
  try {
    res = await fetchImpl(`${packsBase()}pronunciation.json`, { cache: 'no-cache' });
  } catch (e) {
    return { status: 'error', drills: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')) return { status: 'empty', drills: [] };
  if (!res.ok) return { status: 'error', drills: [], error: `pronunciation.json: HTTP ${res.status}` };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return { status: 'error', drills: [], error: 'pronunciation.json is not valid JSON.' };
  }
  const parsed = PronunciationPack.safeParse(raw);
  if (!parsed.success) {
    return { status: 'error', drills: [], error: `pronunciation.json failed validation: ${parsed.error.issues[0]?.message ?? ''}` };
  }
  return { status: parsed.data.drills.length ? 'ready' : 'empty', drills: parsed.data.drills };
}

type PronStore = PronState & { load: (fetchImpl?: typeof fetch) => Promise<void>; setDrills: (d: PronunciationDrill[]) => void };

export const usePronunciation = create<PronStore>((set, get) => ({
  status: 'idle',
  drills: [],
  load: async (fetchImpl) => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    set(await loadPronunciation(fetchImpl));
  },
  setDrills: (drills) => set({ status: drills.length ? 'ready' : 'empty', drills, error: undefined }),
}));

/** Audio paths in a drill are relative to packs/audio/pronunciation/<drill id>/. */
export function drillAudioUrl(drill: Pick<PronunciationDrill, 'id'>, path?: string): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  return `${packsBase()}audio/pronunciation/${drill.id}/${path}`;
}

/** Unit id used by drill attempts (`pron-<drill id>`), shared with the engine. */
export const drillUnitId = (drill: Pick<PronunciationDrill, 'id'>) => engineDrillUnitId(drill.id);

export type DrillItem = { text: string; en: string; audio?: string };

/** A speak exercise for one drill word or sentence, so the engine's speaking grader can score it. */
export function drillSpeakExercise(
  drill: PronunciationDrill,
  kind: 'pair' | 'word' | 'sentence',
  index: number,
  item: DrillItem,
): Extract<Exercise, { type: 'speak' }> {
  return {
    id: `${drillUnitId(drill)}-${kind}-${index}`,
    type: 'speak',
    skill: 'speaking',
    variety: drill.variety,
    prompt: 'Say it aloud.',
    explanation: drill.commonMistakes[0] ?? drill.tips[0] ?? 'Listen again and compare.',
    grammar: [],
    target: item.text,
    ...(item.audio ? { audio: item.audio } : {}),
  };
}

/** "Which did you hear?" items: each word of every pair once (max 10), from the engine's quiz builder. */
export function discriminationQuiz(drill: Pick<PronunciationDrill, 'id' | 'pairs'>, seed: number | string = drill.id): MinimalPairItem[] {
  return minimalPairQuiz(drill, Math.min(10, drill.pairs.length * 2), seed);
}

/** Stores a drill attempt as an engine Attempt (unit id `pron-<id>`, level and variety from the drill). */
export async function recordDrillAttempt(drill: PronunciationDrill, exerciseId: string, score: number, skill: Skill = 'speaking'): Promise<void> {
  const row: AttemptRow = {
    exerciseId,
    unitId: drillUnitId(drill),
    level: drill.level,
    skill,
    variety: drill.variety,
    score: Math.max(0, Math.min(1, score)),
    grammar: [],
    at: new Date().toISOString(),
  };
  await db.attempts.add(row);
}

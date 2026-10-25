// Loads compiled level packs from /packs (built by tools/ into apps/web/public/packs).
import { create } from 'zustand';
import {
  LevelPack,
  PackIndex,
  type CompiledUnit,
  type Exercise,
  type Level,
} from '@doppelpunkt/content-schema';

export type ContentStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export type ContentState = {
  status: ContentStatus;
  packs: LevelPack[];
  /** Problems with individual packs (the rest still loads). */
  warnings: string[];
  error?: string;
};

const packsBase = (): string => `${import.meta.env.BASE_URL ?? '/'}packs/`;

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown | undefined> {
  const res = await fetchImpl(url, { cache: 'no-cache' });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  // Dev servers answer unknown paths with index.html; treat that as "missing".
  if (type.includes('text/html')) return undefined;
  return res.json();
}

/** Fetches index.json, then every pack it lists, validating each with the content schema. */
export async function loadPacks(fetchImpl: typeof fetch = fetch): Promise<ContentState> {
  let rawIndex: unknown;
  try {
    rawIndex = await fetchJson(`${packsBase()}index.json`, fetchImpl);
  } catch (e) {
    return { status: 'error', packs: [], warnings: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (rawIndex === undefined) return { status: 'empty', packs: [], warnings: [] };
  const index = PackIndex.safeParse(rawIndex);
  if (!index.success) {
    return { status: 'error', packs: [], warnings: [], error: `packs/index.json is invalid: ${index.error.message}` };
  }
  const warnings: string[] = [];
  const packs: LevelPack[] = [];
  await Promise.all(
    index.data.packs.map(async (entry) => {
      try {
        const raw = await fetchJson(`${packsBase()}${entry.file}`, fetchImpl);
        if (raw === undefined) return void warnings.push(`${entry.file} is listed but missing.`);
        const parsed = LevelPack.safeParse(raw);
        if (!parsed.success) return void warnings.push(`${entry.file} failed validation: ${parsed.error.issues[0]?.message ?? ''}`);
        packs.push(parsed.data);
      } catch (e) {
        warnings.push(`${entry.file}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );
  packs.sort((a, b) => a.level.localeCompare(b.level));
  return { status: packs.length ? 'ready' : 'empty', packs, warnings };
}

/**
 * Re-requests the index and every listed pack so the service worker's runtime cache holds them.
 * On the very first visit the packs load before the worker controls the page, so without this the
 * app would have no lessons offline until the next online visit.
 */
export async function warmPackCache(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const raw = await fetchJson(`${packsBase()}index.json`, fetchImpl);
    const index = PackIndex.safeParse(raw);
    if (!index.success) return;
    await Promise.all(index.data.packs.map((entry) => fetchImpl(`${packsBase()}${entry.file}`).catch(() => undefined)));
  } catch {
    // Offline or not served: nothing to warm.
  }
}

type ContentStore = ContentState & { load: (fetchImpl?: typeof fetch) => Promise<void>; setPacks: (packs: LevelPack[]) => void };

export const useContent = create<ContentStore>((set, get) => ({
  status: 'idle',
  packs: [],
  warnings: [],
  load: async (fetchImpl) => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    set(await loadPacks(fetchImpl));
  },
  setPacks: (packs) => set({ status: packs.length ? 'ready' : 'empty', packs, warnings: [], error: undefined }),
}));

export function findPack(packs: LevelPack[], level: Level): LevelPack | undefined {
  return packs.find((p) => p.level === level);
}

export function findUnit(packs: LevelPack[], unitId: string): CompiledUnit | undefined {
  for (const p of packs) {
    const u = p.units.find((x) => x.id === unitId);
    if (u) return u;
  }
  return undefined;
}

export function allUnits(packs: LevelPack[]): CompiledUnit[] {
  return packs.flatMap((p) => p.units);
}

/** The unit (and so the level) an exercise belongs to. */
export function unitOfExercise(packs: LevelPack[], exerciseId: string): CompiledUnit | undefined {
  return allUnits(packs).find((u) => u.exercises.some((e: Exercise) => e.id === exerciseId));
}

/** Resolves an audio path from content (relative to the unit folder) to a URL under /packs. */
export function audioUrl(unit: Pick<CompiledUnit, 'id' | 'level'>, path: string): string {
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  return `${packsBase()}audio/${unit.level.toLowerCase()}/${unit.id}/${path}`;
}

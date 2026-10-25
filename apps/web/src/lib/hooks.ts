import { useEffect, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { addActivity, db, DEFAULT_SETTINGS, type Settings } from '../db';

// One app-wide settings subscription. With a live query per component, components could see a
// settings change at different moments (e.g. the onboarding gate still saw onboarded=false after
// onboarding had navigated to /learn, and bounced the learner back to /welcome).
let current: Settings | undefined;
let started = false;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!started) {
    started = true;
    liveQuery(async () => {
      const row = await db.settings.get('app');
      return { ...DEFAULT_SETTINGS, ...row, models: { ...row?.models } };
    }).subscribe({
      next: (value) => {
        current = value;
        for (const l of listeners) l();
      },
      error: (e: unknown) => console.warn('settings query failed', e),
    });
  }
  return () => listeners.delete(onChange);
}

/** Current settings merged with defaults; undefined while IndexedDB is loading. */
export function useSettings(): Settings | undefined {
  return useSyncExternalStore(subscribe, () => current);
}

export function useAttempts(unitId?: string) {
  return useLiveQuery(
    () => (unitId ? db.attempts.where('unitId').equals(unitId).toArray() : db.attempts.toArray()),
    [unitId],
  );
}

export function useUnitStatus(unitId: string) {
  return useLiveQuery(() => db.unitStatus.get(unitId), [unitId]);
}

/** Counts active study time (tab visible) towards today's minutes. */
export function useActivityTimer(intervalSec = 30): void {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void addActivity(intervalSec);
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [intervalSec]);
}

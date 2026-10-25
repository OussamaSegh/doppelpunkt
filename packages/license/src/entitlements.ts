/**
 * Which levels and units a learner may open. Pure functions; the app feeds them the verified
 * payloads of the tokens on the device.
 *
 * - A1 is always free.
 * - Unit 1 of every level is a free preview.
 * - A level is unlocked by any valid, unexpired token that lists it.
 * - Without billing (`gated: false`: no billing URL or no public key in the build) everything is open.
 */
import { FREE_LEVEL, FREE_PREVIEW_UNIT, type PaidLevel } from './catalog';
import type { LicensePayload } from './token';

export type Entitlements = {
  /** false = billing is not configured in this build; nothing is locked. */
  gated: boolean;
  /** Paid levels unlocked by a valid token. */
  levels: ReadonlySet<string>;
};

export const UNGATED: Entitlements = { gated: false, levels: new Set() };

/** Levels unlocked by these (already signature-checked) payloads at `now` (ms). */
export function unlockedLevels(payloads: readonly LicensePayload[], now = Date.now()): Set<PaidLevel> {
  const out = new Set<PaidLevel>();
  for (const p of payloads) {
    if (p.exp !== undefined && p.exp * 1000 <= now) continue;
    for (const l of p.lv) out.add(l);
  }
  return out;
}

export function levelUnlocked(level: string, ent: Entitlements): boolean {
  return !ent.gated || level === FREE_LEVEL || ent.levels.has(level);
}

export function isFreePreview(unit: { level: string; number: number }): boolean {
  return unit.level !== FREE_LEVEL && unit.number === FREE_PREVIEW_UNIT;
}

export function unitUnlocked(unit: { level: string; number: number }, ent: Entitlements): boolean {
  return levelUnlocked(unit.level, ent) || unit.number === FREE_PREVIEW_UNIT;
}

/** Date helpers. Everything is UTC and day-granular; the collector never stores times of day for installs. */

export const DAY_MS = 86_400_000;

/** ISO date (YYYY-MM-DD) of a timestamp. */
export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 for an ISO date, or NaN when it is not a real date. */
export function dayNumber(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Number.NaN;
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms) || isoDay(ms) !== day) return Number.NaN; // rejects 2026-02-31
  return ms / DAY_MS;
}

/** Day number of the Monday of the ISO week that contains `day`. */
export function mondayNumber(day: string): number {
  const n = dayNumber(day);
  const dow = (new Date(n * DAY_MS).getUTCDay() + 6) % 7; // Monday = 0
  return n - dow;
}

/** ISO 8601 week, e.g. "2026-W43". */
export function isoWeek(day: string): string {
  const thursday = mondayNumber(day) + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const jan4 = dayNumber(`${year}-01-04`);
  const week = 1 + Math.floor((thursday - mondayNumber(isoDay(jan4 * DAY_MS))) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Whole ISO weeks from the week of `first` to the week of `day` (0 = same week). */
export function weeksBetween(first: string, day: string): number {
  return Math.floor((mondayNumber(day) - mondayNumber(first)) / 7);
}

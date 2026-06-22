/**
 * Date-only helpers, noon-normalized to avoid TZ/DST drift.
 * Mirrors the convention used by CalendarView.isNextDay / toLocalDateStr.
 */

/** Format a Date as a local YYYY-MM-DD string (no UTC shift). */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Add `days` to an ISO date string, returning an ISO date string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateStr(d);
}

/** Whole-day difference b - a (in nights), date-only. */
export function diffDays(aIso: string, bIso: string): number {
  const a = new Date(`${aIso}T12:00:00`).getTime();
  const b = new Date(`${bIso}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** True iff b is exactly the day after a. */
export function isNextDay(aIso: string, bIso: string): boolean {
  return diffDays(aIso, bIso) === 1;
}

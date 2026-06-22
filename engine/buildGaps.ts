/**
 * buildGaps — derive gaps from local availability rows. Pure, no I/O.
 *
 * A gap is a maximal run of `available` NIGHTS bounded by booked/blocked days or
 * by `today` / horizon end. Any non-'available' status (or a missing date) is a
 * boundary: we only ever sell nights explicitly marked available.
 */

import { addDays, diffDays } from './dates.ts';
import type { AvailabilityRow, Gap } from './types.ts';

export interface BuildGapsOptions {
  unitId: string;
  rows: AvailabilityRow[];
  /** First night considered (inclusive), ISO. Typically "today". */
  todayISO: string;
  /** Last night considered (inclusive), ISO. Typically today + horizon_days. */
  horizonISO: string;
}

export function buildGaps(opts: BuildGapsOptions): Gap[] {
  const { unitId, rows, todayISO, horizonISO } = opts;
  const status = new Map<string, string>();
  for (const r of rows) status.set(r.date, r.status);

  const gaps: Gap[] = [];
  let runStart: string | null = null;
  let runLen = 0;

  const flush = () => {
    if (runStart !== null && runLen > 0) {
      gaps.push({
        gapId: `${unitId}:${runStart}`,
        unitId,
        startDate: runStart,
        length: runLen,
        leadDays: Math.max(0, diffDays(todayISO, runStart)),
      });
    }
    runStart = null;
    runLen = 0;
  };

  for (let date = todayISO; diffDays(date, horizonISO) >= 0; date = addDays(date, 1)) {
    if (status.get(date) === 'available') {
      if (runStart === null) runStart = date;
      runLen++;
    } else {
      flush();
    }
  }
  flush();
  return gaps;
}

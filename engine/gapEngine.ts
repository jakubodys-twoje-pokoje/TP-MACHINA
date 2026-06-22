/**
 * Gap Protection Engine — PURE CORE.
 * =================================================================
 * Deterministic, stateless. Input: one gap + resolved config (+ overrides).
 * Output: per-night CTA/CTD/MIN/MAX restrictions. No I/O.
 *
 * See docs/GAP_PROTECTION_ENGINE.md §4 for the full model. Boundary convention:
 *   gap_start = earliest arrival (first free night)
 *   gap_end   = latest departure (morning after the last free night)
 *   L         = gap_end - gap_start (nights)
 *   offsets from gap_start: arrival a∈[0..L-1], departure d∈[a+minLos..L]
 *
 * Invariant (spec, verbatim):
 *   left_remaining_gap  = a       must be 0 OR >= minimal_acceptable_gap
 *   right_remaining_gap = L - d   must be 0 OR >= minimal_acceptable_gap
 *   stay length d - a   must be   >= effective_min_los  (and <= max_los if set)
 *
 * Operating assumption: restrictions are RECOMPUTED on every availability sync.
 * They shape the NEXT single reservation; adjacent multi-bookings emerge by
 * iteration (each booking splits the gap, the next sync re-derives fresh gaps).
 */

import { addDays } from './dates.ts';
import type { Bool01, DayRestriction, Gap, GapEngineConfig, Override } from './types.ts';

interface Stay { a: number; d: number; len: number; }

export interface EffectiveParams {
  effMinLos: number;
  gapFloor: number;
  emergency: boolean;
  shortened: boolean;
  unsellable: boolean;
}

/** Resolve the gap-level params (floor + emergency). Min LOS is now per arrival night. */
export function resolveGapParams(gap: Gap, cfg: GapEngineConfig): { gapFloor: number; emergency: boolean } {
  const lastMinute = gap.leadDays <= cfg.lastMinuteLeadDays;
  const emergency = cfg.emergencyMode || lastMinute;
  const gapFloor = emergency ? cfg.emergencyAcceptableGap : cfg.minAcceptableGap;
  return { gapFloor, emergency };
}

/**
 * Core engine. One gap + resolved config (+ overrides) → per-night restrictions.
 *
 * `minLosByDate` carries the CENNIK Min LOS per date (prices.min of the calendar cell).
 * Each candidate ARRIVAL night uses its OWN date's min (not a single gap-wide value);
 * config.standardMinLos is only the fallback when a cell has no min.
 */
export function computeGapRestrictions(
  gap: Gap,
  cfg: GapEngineConfig,
  overrides: Override[] = [],
  minLosByDate?: Map<string, number>,
): DayRestriction[] {
  const L = gap.length;
  const out: DayRestriction[] = [];
  if (L <= 0) return out;

  const { gapFloor, emergency } = resolveGapParams(gap, cfg);
  const overrideByDate = new Map<string, Override>(overrides.map(o => [o.date, o]));

  // Min LOS for an arrival on night offset p: that cell's cennik min, else config fallback.
  const rawMinAt = (p: number): number => {
    const v = minLosByDate?.get(addDays(gap.startDate, p));
    return v !== undefined && v !== null && v > 0 ? v : cfg.standardMinLos;
  };

  // Effective min LOS for arrival p, after emergency shortening. Infinity = can't sell here.
  let shortened = false;
  const effMinLosAt = (p: number): number => {
    let m = rawMinAt(p);
    const room = L - p;            // max nights bookable from this arrival to gap end
    if (m > room) {
      if (emergency && cfg.allowShortenMinLos) { m = room; shortened = true; }
      else return Infinity;        // priority 5: don't sell a too-short stay here
    }
    return m;
  };

  // Enumerate acceptable stays with PER-ARRIVAL min LOS.
  const leftOk = (a: number) => a === 0 || a >= gapFloor;
  const rightOk = (d: number) => (L - d) === 0 || (L - d) >= gapFloor;
  const stays: Stay[] = [];
  for (let a = 0; a < L; a++) {
    if (!leftOk(a)) continue;
    const m = effMinLosAt(a);
    if (!Number.isFinite(m)) continue;
    for (let d = a + m; d <= L; d++) {
      if (!rightOk(d)) continue;
      const len = d - a;
      if (cfg.maxLos !== null && len > cfg.maxLos) continue;
      stays.push({ a, d, len });
    }
  }

  const unsellable = stays.length === 0;
  const baseConfidence = unsellable ? 0.3 : (emergency || shortened ? 0.6 : 1.0);

  for (let i = 0; i < L; i++) {
    const date = addDays(gap.startDate, i);

    if (unsellable) {
      // Nothing sellable anywhere in this gap → close arrivals, flag for override.
      out.push(applyOverride({
        date,
        cta: 1,
        ctd: i === 0 ? 0 : 1,           // keep prior guest's checkout open on day 0
        minLos: rawMinAt(i),
        maxLos: null,
        reason: 'gap_unsellable_below_min_los',
        gapId: gap.gapId,
        source: 'auto',
        confidence: 0.3,
      }, overrideByDate));
      continue;
    }

    const arrivals = stays.filter(s => s.a === i);
    const departures = stays.filter(s => s.d === i);   // d===L lands on gap_end (no row)

    const cta: Bool01 = arrivals.length > 0 ? 0 : 1;
    // Day 0 (gap_start) is the PRIOR reservation's checkout day — never block CTD there.
    const ctd: Bool01 = i === 0 ? 0 : (departures.length > 0 ? 0 : 1);

    const minLos = arrivals.length > 0 ? Math.min(...arrivals.map(s => s.len)) : rawMinAt(i);
    const maxLosFromStay = arrivals.length > 0 ? Math.max(...arrivals.map(s => s.len)) : null;
    const maxLos = maxLosFromStay === null
      ? null
      : (cfg.maxLos !== null ? Math.min(cfg.maxLos, maxLosFromStay) : maxLosFromStay);

    out.push(applyOverride({
      date,
      cta,
      ctd,
      minLos,
      maxLos,
      reason: reasonFor(i, L, cta, ctd, rawMinAt(i), gapFloor, arrivals.length > 0),
      gapId: gap.gapId,
      source: 'auto',
      confidence: baseConfidence,
    }, overrideByDate));
  }
  return out;
}

function reasonFor(
  i: number, L: number, cta: Bool01, ctd: Bool01,
  effMinLos: number, gapFloor: number, hasArrival: boolean,
): string {
  if (cta === 1) {
    const leftBlocked = i >= 1 && i < gapFloor;          // would leave 1..gapFloor-1 on the left
    const tailBlocked = i > L - effMinLos;               // not enough nights left for min LOS
    if (leftBlocked && tailBlocked) return 'cta_left_gap_and_min_los_tail';
    if (leftBlocked) return 'cta_protect_left_gap';
    if (tailBlocked) return 'cta_min_los_tail';
    return 'cta_no_valid_stay';
  }
  if (ctd === 1) {
    const rightBlocked = (L - i) >= 1 && (L - i) < gapFloor;  // would leave 1..gapFloor-1 on the right
    const headBlocked = i < effMinLos;                        // too early for any min LOS checkout
    if (rightBlocked && headBlocked) return 'ctd_right_gap_and_min_los_head';
    if (rightBlocked) return 'ctd_protect_right_gap';
    if (headBlocked) return 'ctd_min_los_head';
    return 'ctd_no_valid_departure';
  }
  return hasArrival ? 'arrival_open' : 'open';
}

function applyOverride(row: DayRestriction, overrideByDate: Map<string, Override>): DayRestriction {
  const ov = overrideByDate.get(row.date);
  if (!ov) return row;
  return {
    ...row,
    cta: ov.cta !== undefined ? ov.cta : row.cta,
    ctd: ov.ctd !== undefined ? ov.ctd : row.ctd,
    minLos: ov.minLos !== undefined ? ov.minLos : row.minLos,
    reason: ov.reason ?? 'manual_override',
    source: 'manual',
    confidence: 1.0,
  };
}

/** Convenience: compute restrictions for many gaps and flatten. */
export function computeRestrictionsForGaps(
  gaps: Gap[],
  cfgFor: (gap: Gap) => GapEngineConfig,
  overridesFor: (gap: Gap) => Override[] = () => [],
): DayRestriction[] {
  const all: DayRestriction[] = [];
  for (const gap of gaps) {
    all.push(...computeGapRestrictions(gap, cfgFor(gap), overridesFor(gap)));
  }
  return all;
}

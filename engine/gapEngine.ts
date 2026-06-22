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

/** Resolve the dynamic effective_min_los and gap floor for a gap. */
export function resolveEffectiveParams(gap: Gap, cfg: GapEngineConfig): EffectiveParams {
  const lastMinute = gap.leadDays <= cfg.lastMinuteLeadDays;
  const emergency = cfg.emergencyMode || lastMinute;
  const gapFloor = emergency ? cfg.emergencyAcceptableGap : cfg.minAcceptableGap;

  let effMinLos = cfg.standardMinLos;
  let shortened = false;
  let unsellable = false;

  if (cfg.standardMinLos > gap.length) {
    // Standard stay does not fit the gap at all.
    if (emergency && cfg.allowShortenMinLos) {
      effMinLos = gap.length;   // collapse to a single full-fill stay (priority 4)
      shortened = true;
    } else {
      unsellable = true;        // priority 5: never leave an unsellable fragment silently
    }
  }
  return { effMinLos, gapFloor, emergency, shortened, unsellable };
}

/** All acceptable single reservations for the gap as it exists NOW (empty). */
export function enumerateAcceptableStays(
  L: number, effMinLos: number, gapFloor: number, maxLos: number | null,
): Stay[] {
  const stays: Stay[] = [];
  const leftOk = (a: number) => a === 0 || a >= gapFloor;
  const rightOk = (d: number) => (L - d) === 0 || (L - d) >= gapFloor;
  for (let a = 0; a <= L - effMinLos; a++) {
    if (!leftOk(a)) continue;
    for (let d = a + effMinLos; d <= L; d++) {
      if (!rightOk(d)) continue;
      const len = d - a;
      if (maxLos !== null && len > maxLos) continue;
      stays.push({ a, d, len });
    }
  }
  return stays;
}

/**
 * Core engine. One gap + resolved config (+ overrides) → per-night restrictions.
 */
export function computeGapRestrictions(
  gap: Gap,
  cfg: GapEngineConfig,
  overrides: Override[] = [],
): DayRestriction[] {
  const L = gap.length;
  const out: DayRestriction[] = [];
  if (L <= 0) return out;

  const p = resolveEffectiveParams(gap, cfg);
  const overrideByDate = new Map<string, Override>(overrides.map(o => [o.date, o]));

  // Unsellable gap: close every arrival, flag for manual override (priority 5).
  if (p.unsellable) {
    for (let i = 0; i < L; i++) {
      out.push(applyOverride({
        date: addDays(gap.startDate, i),
        cta: 1,
        ctd: i === 0 ? 0 : 1,           // keep prior guest's checkout open on day 0
        minLos: cfg.standardMinLos,
        maxLos: null,
        reason: 'gap_unsellable_below_min_los',
        gapId: gap.gapId,
        source: 'auto',
        confidence: 0.3,
      }, overrideByDate));
    }
    return out;
  }

  const stays = enumerateAcceptableStays(L, p.effMinLos, p.gapFloor, cfg.maxLos);
  const baseConfidence = (p.emergency || p.shortened) ? 0.6 : 1.0;

  for (let i = 0; i < L; i++) {
    const date = addDays(gap.startDate, i);

    const arrivals = stays.filter(s => s.a === i);
    const departures = stays.filter(s => s.d === i);   // d===L lands on gap_end (no row)

    const cta: Bool01 = arrivals.length > 0 ? 0 : 1;
    // Day 0 (gap_start) is the PRIOR reservation's checkout day — never block CTD there.
    const ctd: Bool01 = i === 0 ? 0 : (departures.length > 0 ? 0 : 1);

    const minLos = arrivals.length > 0 ? Math.min(...arrivals.map(s => s.len)) : p.effMinLos;
    const maxLosFromStay = arrivals.length > 0 ? Math.max(...arrivals.map(s => s.len)) : null;
    const maxLos = maxLosFromStay === null
      ? null
      : (cfg.maxLos !== null ? Math.min(cfg.maxLos, maxLosFromStay) : maxLosFromStay);

    out.push(applyOverride({
      date,
      cta,
      ctd,
      minLos: cta === 1 ? p.effMinLos : minLos,
      maxLos,
      reason: reasonFor(i, L, cta, ctd, p.effMinLos, p.gapFloor, arrivals.length > 0),
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

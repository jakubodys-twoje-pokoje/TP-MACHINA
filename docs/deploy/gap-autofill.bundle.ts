// gap-autofill — SELF-CONTAINED Edge Function (paste-ready for Supabase Dashboard).
// Generated from the tested engine/ + _shared/ sources. No local imports.
// Do NOT paste this in the SQL editor — create it under: Supabase → Edge Functions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ===== engine/dates.ts =====
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

// ===== engine/types.ts =====
/**
 * Gap Protection Engine — shared types.
 *
 * Dual-runtime: this module is pure TypeScript with no dependency on the browser,
 * Node, Deno, Supabase or Hotres. It is imported by both the Vite frontend and the
 * `compute-gap-restrictions` Supabase edge function (Deno).
 */

export type Bool01 = 0 | 1;

/** Gap Assistant operating mode (per property). */
export type GapMode = 'off' | 'suggest' | 'autofill';

/** A single gap to evaluate — purely positional, no availability rows. */
export interface Gap {
  gapId: string;
  unitId: string;
  /** ISO date (YYYY-MM-DD) of the first free night = earliest possible arrival. */
  startDate: string;
  /** Gap length in nights (= gap_end - gap_start). */
  length: number;
  /** Nights between "today" and startDate. Drives last-minute mode. */
  leadDays: number;
}

/** Resolved config for ONE gap (season/channel/date-range already resolved upstream). */
export interface GapEngineConfig {
  /** Standard minimum length of stay (nights). */
  standardMinLos: number;
  /** Smallest empty remainder we may leave after a booking (nights). */
  minAcceptableGap: number;
  /** Relaxed remainder allowed in emergency / last-minute (nights). */
  emergencyAcceptableGap: number;
  /** Optional channel cap on stay length. null = no cap. */
  maxLos: number | null;
  /** leadDays <= this => last-minute mode is eligible. */
  lastMinuteLeadDays: number;
  /** Operator-forced emergency mode for this gap. */
  emergencyMode: boolean;
  /** Permit lowering min LOS to fill a gap shorter than standardMinLos. */
  allowShortenMinLos: boolean;
  /** Operating mode. Off = don't compute/show; suggest = manual push; autofill = auto push. */
  mode?: GapMode;
}

/** Operator override for a single date. Provided fields win over the auto output. */
export interface Override {
  date: string;
  cta?: Bool01;
  ctd?: Bool01;
  minLos?: number | null;
  reason?: string;
}

/** Engine output — one row per night in the gap. Maps 1:1 to `gap_restrictions`. */
export interface DayRestriction {
  date: string;
  cta: Bool01;
  ctd: Bool01;
  minLos: number | null;
  maxLos: number | null;
  reason: string;
  gapId: string;
  source: 'auto' | 'manual';
  /** 0..1. 1 = deterministic certainty; lower = emergency / needs review. */
  confidence: number;
}

/** Availability row as stored locally (subset used by buildGaps). */
export interface AvailabilityRow {
  date: string;
  status: 'available' | 'booked' | 'blocked' | string;
}

/** Config row as stored in `gap_engine_config` (NULL = "any"). */
export interface GapConfigRow {
  property_id: string | null;
  unit_id: string | null;
  unit_type: string | null;
  season: string | null;
  channel: string | null;
  date_from: string | null;
  date_to: string | null;
  standard_min_los: number;
  min_acceptable_gap: number;
  emergency_acceptable_gap: number;
  max_los: number | null;
  last_minute_lead_days: number;
  emergency_mode: boolean;
  allow_shorten_min_los: boolean;
  horizon_days: number;
  priority: number;
  mode: GapMode;
}

/** Context used to resolve the most-specific config for a given date/unit. */
export interface ConfigContext {
  propertyId?: string | null;
  unitId?: string | null;
  unitType?: string | null;
  season?: string | null;
  channel?: string | null;
  date?: string | null;
}

// ===== engine/gapEngine.ts =====
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

// ===== engine/buildGaps.ts =====
/**
 * buildGaps — derive gaps from local availability rows. Pure, no I/O.
 *
 * A gap is a maximal run of `available` NIGHTS bounded by booked/blocked days or
 * by `today` / horizon end. Any non-'available' status (or a missing date) is a
 * boundary: we only ever sell nights explicitly marked available.
 */


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

// ===== engine/resolveConfig.ts =====
/**
 * resolveConfig — pick the most-specific matching config row for a context. Pure.
 *
 * Scope fields that are NULL act as wildcards. Among matching rows, the one with
 * the most non-null scope fields wins; ties break by `priority` (desc), then by
 * presence of a date range (more specific). If nothing matches, DEFAULT_CONFIG.
 */


/** Hardcoded fallback used when no config row matches (see docs §11 decisions). */
export const DEFAULT_CONFIG: GapEngineConfig = {
  standardMinLos: 2,
  minAcceptableGap: 3,
  emergencyAcceptableGap: 2,
  maxLos: null,
  lastMinuteLeadDays: 7,
  emergencyMode: false,
  allowShortenMinLos: true,
  mode: 'suggest',
};

export const DEFAULT_HORIZON_DAYS = 365;

function rowToConfig(row: GapConfigRow): GapEngineConfig {
  return {
    standardMinLos: row.standard_min_los,
    minAcceptableGap: row.min_acceptable_gap,
    emergencyAcceptableGap: row.emergency_acceptable_gap,
    maxLos: row.max_los,
    lastMinuteLeadDays: row.last_minute_lead_days,
    emergencyMode: row.emergency_mode,
    allowShortenMinLos: row.allow_shorten_min_los,
    mode: row.mode ?? 'suggest',
  };
}

function matches(row: GapConfigRow, ctx: ConfigContext): boolean {
  const scopeOk =
    (row.property_id === null || row.property_id === ctx.propertyId) &&
    (row.unit_id === null || row.unit_id === ctx.unitId) &&
    (row.unit_type === null || row.unit_type === ctx.unitType) &&
    (row.season === null || row.season === ctx.season) &&
    (row.channel === null || row.channel === ctx.channel);
  if (!scopeOk) return false;
  if (row.date_from !== null && (!ctx.date || ctx.date < row.date_from)) return false;
  if (row.date_to !== null && (!ctx.date || ctx.date > row.date_to)) return false;
  return true;
}

function specificity(row: GapConfigRow): number {
  let s = 0;
  if (row.property_id !== null) s++;
  if (row.unit_id !== null) s += 2;          // unit is the most targeted scope
  if (row.unit_type !== null) s++;
  if (row.season !== null) s++;
  if (row.channel !== null) s++;
  if (row.date_from !== null) s++;
  if (row.date_to !== null) s++;
  return s;
}

export function resolveConfig(ctx: ConfigContext, configs: GapConfigRow[]): GapEngineConfig {
  const candidates = configs.filter(r => matches(r, ctx));
  if (candidates.length === 0) return DEFAULT_CONFIG;
  candidates.sort((a, b) => {
    const sd = specificity(b) - specificity(a);
    if (sd !== 0) return sd;
    return b.priority - a.priority;
  });
  return rowToConfig(candidates[0]);
}

export function resolveHorizonDays(ctx: ConfigContext, configs: GapConfigRow[]): number {
  const candidates = configs.filter(r => matches(r, ctx));
  if (candidates.length === 0) return DEFAULT_HORIZON_DAYS;
  candidates.sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority);
  return candidates[0].horizon_days ?? DEFAULT_HORIZON_DAYS;
}

// ===== _shared/gapCompute.ts =====
// Shared compute-and-store for the Gap Protection Engine.
// Used by BOTH the on-demand edge function (compute-gap-restrictions) and the
// scheduled autofill cron (gap-autofill) so the logic lives in exactly one place.

export interface ComputeResult {
  mode: GapMode;
  units: number;
  gaps: number;
  restrictions_upserted: number;
  horizon_days: number;
  range: { from: string; to: string };
  skipped: boolean;
}

// deno-lint-ignore no-explicit-any
export async function computeAndStoreGapRestrictions(
  supabase: any,
  propertyId: string,
  unitId?: string,
): Promise<ComputeResult> {
  const today = toLocalDateStr(new Date());

  // Config rows (global + this property).
  const { data: cfgRowsRaw } = await supabase
    .from('gap_engine_config')
    .select('*')
    .or(`property_id.is.null,property_id.eq.${propertyId}`);
  const cfgRows = (cfgRowsRaw ?? []) as GapConfigRow[];

  // Property-level operating mode (per-obiekt). 'off' → do nothing.
  const propertyCfg = resolveConfig({ propertyId, date: today }, cfgRows);
  const horizonDays = resolveHorizonDays({ propertyId, date: today }, cfgRows);
  const horizon = addDays(today, horizonDays);
  const emptyRange = { from: today, to: horizon };

  if ((propertyCfg.mode ?? 'suggest') === 'off') {
    return { mode: 'off', units: 0, gaps: 0, restrictions_upserted: 0, horizon_days: horizonDays, range: emptyRange, skipped: true };
  }

  let unitQuery = supabase
    .from('units')
    .select('id, type, selected_rate_plan_id')
    .eq('property_id', propertyId);
  if (unitId) unitQuery = unitQuery.eq('id', unitId);
  const { data: units, error: unitsErr } = await unitQuery;
  if (unitsErr) throw unitsErr;
  if (!units || units.length === 0) {
    return { mode: propertyCfg.mode ?? 'suggest', units: 0, gaps: 0, restrictions_upserted: 0, horizon_days: horizonDays, range: emptyRange, skipped: false };
  }

  const { data: ratePlans } = await supabase
    .from('rate_plans')
    .select('id, created_at')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: true });
  const defaultRateId = ratePlans?.[0]?.id ?? null;

  const outputRows: Record<string, unknown>[] = [];
  let gapCount = 0;

  for (const unit of units) {
    const rateId = unit.selected_rate_plan_id ?? defaultRateId;
    if (!rateId) continue; // cannot satisfy gap_restrictions.rate_id FK

    const { data: avail } = await supabase
      .from('availability')
      .select('date, status')
      .eq('unit_id', unit.id)
      .gte('date', today)
      .lte('date', horizon)
      .order('date', { ascending: true });

    const { data: ovrRows } = await supabase
      .from('gap_overrides')
      .select('date_from, date_to, cta, ctd, min_los, reason, expires_at')
      .eq('unit_id', unit.id);
    const overridesByDate = expandOverrides(ovrRows ?? [], today);

    const gaps = buildGaps({ unitId: unit.id, rows: avail ?? [], todayISO: today, horizonISO: horizon });
    gapCount += gaps.length;

    for (const gap of gaps) {
      const cfg = resolveConfig(
        { propertyId, unitId: unit.id, unitType: unit.type, date: gap.startDate },
        cfgRows,
      );
      const overrides: Override[] = [];
      for (let i = 0; i < gap.length; i++) {
        const d = addDays(gap.startDate, i);
        const ov = overridesByDate.get(d);
        if (ov) overrides.push(ov);
      }
      for (const r of computeGapRestrictions(gap, cfg, overrides)) {
        outputRows.push({
          unit_id: unit.id, rate_id: rateId, date: r.date,
          cta: r.cta, ctd: r.ctd, min_los: r.minLos, max_los: r.maxLos,
          gap_id: r.gapId, reason: r.reason, source: r.source, confidence: r.confidence,
        });
      }
    }
  }

  let upserted = 0;
  const BATCH = 500;
  for (let i = 0; i < outputRows.length; i += BATCH) {
    const batch = outputRows.slice(i, i + BATCH);
    const { error } = await supabase.from('gap_restrictions').upsert(batch, { onConflict: 'unit_id,rate_id,date' });
    if (error) throw error;
    upserted += batch.length;
  }

  return {
    mode: propertyCfg.mode ?? 'suggest',
    units: units.length, gaps: gapCount, restrictions_upserted: upserted,
    horizon_days: horizonDays, range: { from: today, to: horizon }, skipped: false,
  };
}

function expandOverrides(
  rows: Array<{ date_from: string; date_to: string; cta: number | null; ctd: number | null; min_los: number | null; reason: string | null; expires_at: string | null }>,
  today: string,
): Map<string, Override> {
  const now = Date.now();
  const map = new Map<string, Override>();
  for (const r of rows) {
    if (r.expires_at && new Date(r.expires_at).getTime() < now) continue;
    for (let d = r.date_from; d <= r.date_to && d >= today; d = addDays(d, 1)) {
      map.set(d, {
        date: d,
        cta: r.cta === null ? undefined : (r.cta as 0 | 1),
        ctd: r.ctd === null ? undefined : (r.ctd as 0 | 1),
        minLos: r.min_los === null ? undefined : r.min_los,
        reason: r.reason ?? undefined,
      });
      if (d >= r.date_to) break;
    }
  }
  return map;
}

// ===== _shared/gapPush.ts =====
// Shared Hotres push helpers for gap_restrictions. Used by gap-autofill (and
// available to any server-side push). Mirrors the client payload shape and
// range compression used by CalendarView's manual push.

interface Unit { id: string; external_type_id: string | null }
interface PushRange { from: string; till: string; cta?: number | null; ctd?: number | null; min?: number | null }
export interface PushPayloadEntry { type_id: number; rate_id: number; mode: string; prices: PushRange[] }

/** Build the Hotres payload from gap_restrictions, compressing consecutive equal days. */
// deno-lint-ignore no-explicit-any
export async function buildHotresPayloadFromGapRestrictions(
  supabase: any,
  units: Unit[],
  plansToSend: Array<{ external_id: string }>,
  startStr: string,
  endStr: string,
): Promise<{ payload: PushPayloadEntry[]; records: number }> {
  const unitIds = units.map(u => u.id);
  const rows: Array<{ unit_id: string; date: string; cta: number | null; ctd: number | null; min_los: number | null }> = [];
  const CHUNK = 50;
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const chunk = unitIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('gap_restrictions')
      .select('unit_id, date, cta, ctd, min_los')
      .in('unit_id', chunk)
      .gte('date', startStr)
      .lte('date', endStr);
    if (error) throw error;
    rows.push(...(data ?? []));
  }

  const byType = new Map<string, Array<{ date: string; cta: number | null; ctd: number | null; min: number | null }>>();
  for (const r of rows) {
    const unit = units.find(u => u.id === r.unit_id);
    if (!unit?.external_type_id) continue;
    if (!byType.has(unit.external_type_id)) byType.set(unit.external_type_id, []);
    byType.get(unit.external_type_id)!.push({ date: r.date, cta: r.cta, ctd: r.ctd, min: r.min_los });
  }

  const payload: PushPayloadEntry[] = [];
  for (const [typeIdStr, items] of byType) {
    items.sort((a, b) => a.date.localeCompare(b.date));
    const ranges: PushRange[] = [];
    let cur: PushRange | null = null;
    for (const it of items) {
      const same = cur && cur.cta === it.cta && cur.ctd === it.ctd && cur.min === it.min;
      if (same && cur && isNextDay(cur.till, it.date)) cur.till = it.date;
      else { if (cur) ranges.push(cur); cur = { from: it.date, till: it.date, cta: it.cta, ctd: it.ctd, min: it.min }; }
    }
    if (cur) ranges.push(cur);
    for (const plan of plansToSend) {
      payload.push({ type_id: parseInt(typeIdStr, 10), rate_id: parseInt(plan.external_id, 10), mode: 'delta', prices: ranges });
    }
  }
  return { payload, records: rows.length };
}

/** Send a payload through the EXISTING update-hotres-prices edge function (same as the user push). */
export async function sendViaUpdateHotresPrices(
  supabaseUrl: string,
  serviceKey: string,
  propertyId: string,
  payload: PushPayloadEntry[],
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/update-hotres-prices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ property_id: propertyId, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`update-hotres-prices (${res.status}): ${data?.error ?? JSON.stringify(data)}`);
}

// ===== handler =====
// Gap Protection Engine — AUTOFILL cron target (Deno edge function).
// Intended to run every ~10 minutes (pg_cron → see migrations/schedule_gap_autofill.sql).
// For each property in 'autofill' mode it: (1) recomputes gap_restrictions,
// (2) reuses the EXISTING user push path (update-hotres-prices), and (3) counts
// each push against the SHARED 10/hour/property limit via hotres_push_log.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PUSH_LIMIT_PER_HOUR = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Optional single-property run (for testing): { property_id }.
    const body = await req.json().catch(() => ({}));
    const onlyProperty: string | undefined = body?.property_id;

    // Properties explicitly set to autofill (per-obiekt rows).
    const { data: cfgRows } = await supabase
      .from('gap_engine_config')
      .select('property_id')
      .eq('mode', 'autofill')
      .not('property_id', 'is', null);
    let propertyIds = [...new Set((cfgRows ?? []).map((r: any) => r.property_id))] as string[];
    if (onlyProperty) propertyIds = propertyIds.filter(id => id === onlyProperty);

    const results: any[] = [];

    for (const propertyId of propertyIds) {
      const r: any = { property_id: propertyId };
      try {
        // 1) Recompute from fresh local data.
        const compute = await computeAndStoreGapRestrictions(supabase, propertyId);
        r.compute = compute;
        if (compute.skipped) { r.status = 'skipped_off'; results.push(r); continue; }

        // 2) Shared rate limit (manual + autofill) — count pushes in the last hour.
        const since = new Date(Date.now() - 3_600_000).toISOString();
        const { count } = await supabase
          .from('hotres_push_log')
          .select('id', { count: 'exact', head: true })
          .eq('property_id', propertyId)
          .gte('pushed_at', since);
        if ((count ?? 0) >= PUSH_LIMIT_PER_HOUR) { r.status = 'rate_limited'; results.push(r); continue; }

        // 3) Resolve push targets (rate plans with external_id) from persisted selection.
        const { data: prop } = await supabase
          .from('properties').select('push_rate_plan_ids').eq('id', propertyId).single();
        const selectedIds: string[] = prop?.push_rate_plan_ids ?? [];
        if (selectedIds.length === 0) { r.status = 'no_push_target'; results.push(r); continue; }

        const { data: ratePlans } = await supabase
          .from('rate_plans').select('id, external_id').eq('property_id', propertyId);
        const plansToSend = (ratePlans ?? [])
          .filter((rp: any) => rp.external_id != null && selectedIds.includes(rp.id))
          .map((rp: any) => ({ external_id: String(rp.external_id) }));
        if (plansToSend.length === 0) { r.status = 'no_valid_rate_plan'; results.push(r); continue; }

        const { data: units } = await supabase
          .from('units').select('id, external_type_id').eq('property_id', propertyId);

        // 4) Build payload from gap_restrictions and push via the existing user function.
        const { from, to } = compute.range;
        const { payload, records } = await buildHotresPayloadFromGapRestrictions(
          supabase, units ?? [], plansToSend, from, to,
        );
        if (payload.length === 0) { r.status = 'nothing_to_push'; results.push(r); continue; }

        await sendViaUpdateHotresPrices(supabaseUrl, serviceKey, propertyId, payload);

        // 5) Log the push so it counts against the shared limit.
        await supabase.from('hotres_push_log').insert({ property_id: propertyId, source: 'autofill', records });
        r.status = 'pushed';
        r.records = records;
      } catch (err: any) {
        r.status = 'error';
        r.error = err?.message ?? String(err);
      }
      results.push(r);
    }

    return json({ success: true, properties: propertyIds.length, results });
  } catch (error: any) {
    console.error('❌ gap-autofill error:', error?.message ?? error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

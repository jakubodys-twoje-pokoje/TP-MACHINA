/**
 * Gap Protection Engine — shared types.
 *
 * Dual-runtime: this module is pure TypeScript with no dependency on the browser,
 * Node, Deno, Supabase or Hotres. It is imported by both the Vite frontend and the
 * `compute-gap-restrictions` Supabase edge function (Deno).
 */

export type Bool01 = 0 | 1;

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

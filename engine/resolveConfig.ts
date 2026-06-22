/**
 * resolveConfig — pick the most-specific matching config row for a context. Pure.
 *
 * Scope fields that are NULL act as wildcards. Among matching rows, the one with
 * the most non-null scope fields wins; ties break by `priority` (desc), then by
 * presence of a date range (more specific). If nothing matches, DEFAULT_CONFIG.
 */

import type { ConfigContext, GapConfigRow, GapEngineConfig } from './types.ts';

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

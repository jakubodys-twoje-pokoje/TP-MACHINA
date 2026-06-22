// Shared compute-and-store for the Gap Protection Engine.
// Used by BOTH the on-demand edge function (compute-gap-restrictions) and the
// scheduled autofill cron (gap-autofill) so the logic lives in exactly one place.
import { buildGaps } from '../../../engine/buildGaps.ts';
import { computeGapRestrictions } from '../../../engine/gapEngine.ts';
import { resolveConfig, resolveHorizonDays } from '../../../engine/resolveConfig.ts';
import { addDays, toLocalDateStr } from '../../../engine/dates.ts';
import type { GapConfigRow, GapMode, Override } from '../../../engine/types.ts';

export interface ComputeResult {
  mode: GapMode;
  units: number;
  gaps: number;
  restrictions_upserted: number;
  horizon_days: number;
  range: { from: string; to: string };
  skipped: boolean;
}

export interface ComputeOptions {
  /** Restrict to these units (e.g. only units with new notifications). Default: all. */
  unitIds?: string[];
  /** Only upsert restrictions whose date is >= this (gaps are still computed with full context). */
  from?: string;
  /** Only upsert restrictions whose date is <= this. */
  to?: string;
}

// deno-lint-ignore no-explicit-any
export async function computeAndStoreGapRestrictions(
  supabase: any,
  propertyId: string,
  opts: ComputeOptions = {},
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
  if (opts.unitIds && opts.unitIds.length > 0) unitQuery = unitQuery.in('id', opts.unitIds);
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
  const inWindow = (d: string) => (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to);

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
        if (!inWindow(r.date)) continue;
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

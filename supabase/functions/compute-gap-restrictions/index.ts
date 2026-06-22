// Gap Protection Engine — I/O wrapper (Deno edge function).
// Reads local availability + config + overrides, runs the PURE shared core
// (engine/*), and upserts per-day restrictions into `gap_restrictions`.
// Hotres is NOT involved here — this only computes & persists. Push is a
// separate, existing step (update-hotres-prices).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildGaps } from '../../../engine/buildGaps.ts';
import { computeGapRestrictions } from '../../../engine/gapEngine.ts';
import { resolveConfig, resolveHorizonDays } from '../../../engine/resolveConfig.ts';
import { addDays, toLocalDateStr } from '../../../engine/dates.ts';
import type { GapConfigRow, Override } from '../../../engine/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { property_id, unit_id } = await req.json();
    if (!property_id) {
      return json({ error: 'property_id is required' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Units in scope (optionally a single unit).
    let unitQuery = supabase
      .from('units')
      .select('id, type, selected_rate_plan_id')
      .eq('property_id', property_id);
    if (unit_id) unitQuery = unitQuery.eq('id', unit_id);
    const { data: units, error: unitsErr } = await unitQuery;
    if (unitsErr) throw unitsErr;
    if (!units || units.length === 0) return json({ error: 'No units for property' }, 404);

    // Rate plans (for rate_id fallback when a unit has no selection).
    const { data: ratePlans } = await supabase
      .from('rate_plans')
      .select('id, created_at')
      .eq('property_id', property_id)
      .order('created_at', { ascending: true });
    const defaultRateId = ratePlans?.[0]?.id ?? null;

    // Config rows (global + this property).
    const { data: cfgRowsRaw } = await supabase
      .from('gap_engine_config')
      .select('*')
      .or(`property_id.is.null,property_id.eq.${property_id}`);
    const cfgRows = (cfgRowsRaw ?? []) as GapConfigRow[];

    const today = toLocalDateStr(new Date());
    const horizonDays = resolveHorizonDays({ propertyId: property_id, date: today }, cfgRows);
    const horizon = addDays(today, horizonDays);

    const outputRows: any[] = [];
    let gapCount = 0;

    for (const unit of units) {
      const rateId = unit.selected_rate_plan_id ?? defaultRateId;
      if (!rateId) continue; // cannot satisfy gap_restrictions.rate_id FK

      // Availability for the horizon.
      const { data: avail } = await supabase
        .from('availability')
        .select('date, status')
        .eq('unit_id', unit.id)
        .gte('date', today)
        .lte('date', horizon)
        .order('date', { ascending: true });

      // Persistent overrides for this unit, expanded to per-date.
      const { data: ovrRows } = await supabase
        .from('gap_overrides')
        .select('date_from, date_to, cta, ctd, min_los, reason, expires_at')
        .eq('unit_id', unit.id);
      const overridesByDate = expandOverrides(ovrRows ?? [], today);

      const gaps = buildGaps({ unitId: unit.id, rows: avail ?? [], todayISO: today, horizonISO: horizon });
      gapCount += gaps.length;

      for (const gap of gaps) {
        const cfg = resolveConfig(
          { propertyId: property_id, unitId: unit.id, unitType: unit.type, date: gap.startDate },
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
            unit_id: unit.id,
            rate_id: rateId,
            date: r.date,
            cta: r.cta,
            ctd: r.ctd,
            min_los: r.minLos,
            max_los: r.maxLos,
            gap_id: r.gapId,
            reason: r.reason,
            source: r.source,
            confidence: r.confidence,
          });
        }
      }
    }

    // Upsert in batches (same conflict key as prices).
    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < outputRows.length; i += BATCH) {
      const batch = outputRows.slice(i, i + BATCH);
      const { error } = await supabase
        .from('gap_restrictions')
        .upsert(batch, { onConflict: 'unit_id,rate_id,date' });
      if (error) throw error;
      upserted += batch.length;
    }

    return json({
      success: true,
      units: units.length,
      gaps: gapCount,
      restrictions_upserted: upserted,
      horizon_days: horizonDays,
      range: { from: today, to: horizon },
    });
  } catch (error: any) {
    console.error('❌ compute-gap-restrictions error:', error?.message ?? error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
});

function expandOverrides(
  rows: Array<{ date_from: string; date_to: string; cta: number | null; ctd: number | null; min_los: number | null; reason: string | null; expires_at: string | null }>,
  today: string,
): Map<string, Override> {
  const now = Date.now();
  const map = new Map<string, Override>();
  for (const r of rows) {
    if (r.expires_at && new Date(r.expires_at).getTime() < now) continue; // expired
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Frontend service for the Gap Protection Engine.
// Bridges the UI to: (1) the compute-gap-restrictions edge function,
// (2) reading `gap_restrictions`, (3) writing `gap_overrides`, and
// (4) pushing engine output to Hotres via the existing update-hotres-prices.
import { supabase } from './supabaseClient';
import type { GapRestriction, GapOverride, Unit, GapMode, GapConfigValues } from '../types';

/** Sensible defaults shown when a property has no config row yet. */
export const DEFAULT_GAP_CONFIG: GapConfigValues = {
  standard_min_los: 2,
  min_acceptable_gap: 3,
  emergency_acceptable_gap: 2,
  max_los: null,
  last_minute_lead_days: 7,
  horizon_days: 365,
  allow_shorten_min_los: true,
  emergency_mode: false,
};

// Identifies the single property-scoped config row (no unit/season/channel/date scope).
const propertyScopeFilter = (q: any, propertyId: string) =>
  q.eq('property_id', propertyId)
    .is('unit_id', null).is('season', null).is('channel', null)
    .is('date_from', null).is('date_to', null);

/** Read the effective editable config for a property (property row → global → defaults). */
export async function getPropertyGapConfig(propertyId: string): Promise<GapConfigValues> {
  const cols = 'standard_min_los, min_acceptable_gap, emergency_acceptable_gap, max_los, last_minute_lead_days, horizon_days, allow_shorten_min_los, emergency_mode';
  const { data: own } = await propertyScopeFilter(
    supabase.from('gap_engine_config').select(cols), propertyId,
  ).limit(1).maybeSingle();
  if (own) return own as GapConfigValues;
  // Fall back to global default row.
  const { data: global } = await supabase
    .from('gap_engine_config').select(cols)
    .is('property_id', null).is('unit_id', null).is('season', null)
    .is('channel', null).is('date_from', null).is('date_to', null)
    .limit(1).maybeSingle();
  return (global as GapConfigValues) ?? DEFAULT_GAP_CONFIG;
}

/** Save the editable config to the property-scoped row (create it if needed, preserving mode). */
export async function savePropertyGapConfig(propertyId: string, values: GapConfigValues): Promise<void> {
  const { data: existing } = await propertyScopeFilter(
    supabase.from('gap_engine_config').select('id'), propertyId,
  ).limit(1).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('gap_engine_config').update(values).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('gap_engine_config').insert({ property_id: propertyId, mode: 'suggest', ...values });
    if (error) throw new Error(error.message);
  }
}

const FUNCTIONS_BASE = 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1';

const CHUNK = 50;

// Date helper, noon-normalized to avoid TZ/DST drift (mirrors CalendarView).
const isNextDay = (d1: string, d2: string): boolean => {
  const a = new Date(d1); const b = new Date(d2);
  a.setHours(12, 0, 0, 0); b.setHours(12, 0, 0, 0);
  return Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86_400_000) === 1 && b > a;
};

async function authedFetch(fn: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Musisz być zalogowany');
  const res = await fetch(`${FUNCTIONS_BASE}/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${fn} (${res.status}): ${json?.error ?? JSON.stringify(json)}`);
  return json;
}

export interface RecomputeScope {
  /** Restrict to these units (e.g. units with new notifications). */
  unitIds?: string[];
  /** Only write restrictions in this date window (gaps still computed with full context). */
  from?: string;
  to?: string;
}

/** Trigger a server-side recompute of gap_restrictions for a property, optionally scoped. */
export async function recomputeGapRestrictions(propertyId: string, scope: RecomputeScope = {}): Promise<{
  units: number; gaps: number; restrictions_upserted: number; mode: string; skipped: boolean;
}> {
  return authedFetch('compute-gap-restrictions', {
    property_id: propertyId,
    unit_ids: scope.unitIds,
    from: scope.from,
    to: scope.to,
  });
}

/** Load gap_restrictions for the given units in a date range. Keyed "unitId_date". */
export async function fetchGapRestrictions(
  unitIds: string[], startStr: string, endStr: string,
): Promise<Map<string, GapRestriction>> {
  const result = new Map<string, GapRestriction>();
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const chunk = unitIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('gap_restrictions')
      .select('*')
      .in('unit_id', chunk)
      .gte('date', startStr)
      .lte('date', endStr);
    if (error) { console.error('fetchGapRestrictions:', error); continue; }
    (data ?? []).forEach((r: GapRestriction) => result.set(`${r.unit_id}_${r.date}`, r));
  }
  return result;
}

/** Read the per-property operating mode from gap_engine_config (property-scoped row). */
export async function getPropertyGapMode(propertyId: string): Promise<GapMode> {
  const { data } = await supabase
    .from('gap_engine_config')
    .select('mode')
    .eq('property_id', propertyId)
    .is('unit_id', null).is('season', null).is('channel', null)
    .is('date_from', null).is('date_to', null)
    .limit(1).maybeSingle();
  return (data?.mode as GapMode) ?? 'suggest';
}

/** Set the per-property operating mode (upsert the property-scoped config row). */
export async function setPropertyGapMode(propertyId: string, mode: GapMode): Promise<void> {
  const { data: existing } = await supabase
    .from('gap_engine_config')
    .select('id')
    .eq('property_id', propertyId)
    .is('unit_id', null).is('season', null).is('channel', null)
    .is('date_from', null).is('date_to', null)
    .limit(1).maybeSingle();
  if (existing?.id) {
    const { error } = await supabase.from('gap_engine_config').update({ mode }).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('gap_engine_config').insert({ property_id: propertyId, mode });
    if (error) throw new Error(error.message);
  }
}

/** Persist the push rate-plan selection to the DB so the autofill cron can read it. */
export async function savePushRatePlanIds(propertyId: string, ids: string[]): Promise<void> {
  await supabase.from('properties').update({ push_rate_plan_ids: ids }).eq('id', propertyId);
}

/** Persist an operator override (survives recompute). */
export async function saveGapOverride(ov: Omit<GapOverride, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('gap_overrides').insert(ov);
  if (error) throw new Error(`Zapis override nie powiódł się: ${error.message}`);
}

/** Remove an override by id. */
export async function deleteGapOverride(id: string): Promise<void> {
  const { error } = await supabase.from('gap_overrides').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

interface PushRange { from: string; till: string; cta?: number | null; ctd?: number | null; min?: number | null; }

/**
 * Push gap_restrictions to Hotres via update-hotres-prices.
 * Compresses consecutive days with identical values into {from,till} ranges and
 * fans out to every selected rate plan, respecting CTA/CTD/MIN being shared per type_id.
 */
export async function pushGapRestrictionsToHotres(args: {
  propertyId: string;
  units: Unit[];
  plansToSend: Array<{ external_id: string }>;
  startStr: string;
  endStr: string;
}): Promise<{ records: number }> {
  const { propertyId, units, plansToSend, startStr, endStr } = args;
  const unitIds = units.map(u => u.id);

  const rows: GapRestriction[] = [];
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const chunk = unitIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('gap_restrictions')
      .select('unit_id, date, cta, ctd, min_los')
      .in('unit_id', chunk)
      .gte('date', startStr)
      .lte('date', endStr);
    if (error) throw new Error(`Błąd pobierania gap_restrictions: ${error.message}`);
    rows.push(...((data ?? []) as GapRestriction[]));
  }
  if (rows.length === 0) throw new Error('Brak gap_restrictions w zakresie. Przelicz ochronę luk najpierw.');

  // Group by external_type_id.
  const byType = new Map<string, Array<{ date: string; cta: number | null; ctd: number | null; min: number | null }>>();
  rows.forEach(r => {
    const unit = units.find(u => u.id === r.unit_id);
    if (!unit?.external_type_id) return;
    if (!byType.has(unit.external_type_id)) byType.set(unit.external_type_id, []);
    byType.get(unit.external_type_id)!.push({ date: r.date, cta: r.cta, ctd: r.ctd, min: r.min_los });
  });

  const payload: Array<{ type_id: number; rate_id: number; mode: string; prices: PushRange[] }> = [];
  for (const [typeIdStr, items] of byType) {
    items.sort((a, b) => a.date.localeCompare(b.date));
    const ranges: PushRange[] = [];
    let cur: PushRange | null = null;
    for (const it of items) {
      const same = cur && cur.cta === it.cta && cur.ctd === it.ctd && cur.min === it.min;
      if (same && cur && isNextDay(cur.till, it.date)) {
        cur.till = it.date;
      } else {
        if (cur) ranges.push(cur);
        cur = { from: it.date, till: it.date, cta: it.cta, ctd: it.ctd, min: it.min };
      }
    }
    if (cur) ranges.push(cur);

    for (const plan of plansToSend) {
      payload.push({ type_id: parseInt(typeIdStr, 10), rate_id: parseInt(plan.external_id, 10), mode: 'delta', prices: ranges });
    }
  }
  if (payload.length === 0) throw new Error('Brak danych do wysłania (sprawdź external_type_id jednostek).');

  await authedFetch('update-hotres-prices', { property_id: propertyId, payload });
  return { records: rows.length };
}

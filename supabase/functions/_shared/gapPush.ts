// Shared Hotres push helpers for gap_restrictions. Used by gap-autofill (and
// available to any server-side push). Mirrors the client payload shape and
// range compression used by CalendarView's manual push.
import { isNextDay } from '../../../engine/dates.ts';

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

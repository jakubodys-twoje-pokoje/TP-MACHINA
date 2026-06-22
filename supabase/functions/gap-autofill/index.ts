// Gap Protection Engine — AUTOFILL cron target (Deno edge function).
// Intended to run every ~10 minutes (pg_cron → see migrations/schedule_gap_autofill.sql).
// For each property in 'autofill' mode it: (1) recomputes gap_restrictions,
// (2) reuses the EXISTING user push path (update-hotres-prices), and (3) counts
// each push against the SHARED 10/hour/property limit via hotres_push_log.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeAndStoreGapRestrictions } from '../_shared/gapCompute.ts';
import { buildHotresPayloadFromGapRestrictions, sendViaUpdateHotresPrices } from '../_shared/gapPush.ts';

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

// Gap Protection Engine — on-demand compute (Deno edge function).
// Thin HTTP wrapper around the shared computeAndStoreGapRestrictions(): reads
// local availability + config + overrides, runs the PURE shared core, and
// upserts per-day restrictions into `gap_restrictions`. Hotres is NOT involved
// here — push is a separate, existing step (update-hotres-prices).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { computeAndStoreGapRestrictions } from '../_shared/gapCompute.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { property_id, unit_id, unit_ids, from, to } = await req.json();
    if (!property_id) return json({ error: 'property_id is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const unitIds: string[] | undefined = unit_ids ?? (unit_id ? [unit_id] : undefined);
    const result = await computeAndStoreGapRestrictions(supabase, property_id, { unitIds, from, to });
    return json({ success: true, ...result });
  } catch (error: any) {
    console.error('❌ compute-gap-restrictions error:', error?.message ?? error);
    return json({ error: error?.message ?? String(error) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

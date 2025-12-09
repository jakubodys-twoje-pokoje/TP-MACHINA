// Fix: Add Deno types reference to resolve 'Deno' not found error.
/// <reference types="https://esm.sh/v135/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import webpush from "https://esm.sh/web-push@3.6.3"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      // Fix: Remove '(Deno as any)' cast as types are now available.
      Deno.env.get('SUPABASE_URL') ?? '',
      // Fix: Remove '(Deno as any)' cast as types are now available.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { record } = await req.json()
    
    // Configure web-push
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      // Fix: Remove '(Deno as any)' cast as types are now available.
      Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      // Fix: Remove '(Deno as any)' cast as types are now available.
      Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    )

    // Get subscriptions for the user
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', record.user_id)

    if (!subscriptions) return new Response(JSON.stringify({ message: 'No subscriptions' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const payload = JSON.stringify({
      title: 'Zmiana dostępności!',
      body: `${record.change_type === 'available' ? 'Zwolniono' : 'Zablokowano'} termin w ${record.unit_name}`,
      url: `/property/${record.property_id}/units`
    })

    const results = await Promise.all(
        subscriptions.map(sub => 
            webpush.sendNotification(sub.subscription, payload)
                .catch(err => console.error("Push error", err))
        )
    )

    return new Response(JSON.stringify({ success: true, count: results.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

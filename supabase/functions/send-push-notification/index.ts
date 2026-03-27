import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1'
import webpush from "https://esm.sh/web-push@3.6.3"

declare const Deno: any;

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
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const {
      property_id,
      unit_id,
      property_name,
      unit_name,
      change_type,
      start_date,
      end_date
    } = await req.json()

    // Configure web-push
    webpush.setVapidDetails(
      'mailto:admin@twojepokoje.com.pl',
      Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    )

    // Get ALL subscriptions (notifications are shared between all users)
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('subscription, endpoint')

    if (subError) {
      console.error('Error fetching subscriptions:', subError)
      return new Response(JSON.stringify({ error: subError.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      })
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No push subscriptions found')
      return new Response(JSON.stringify({ message: 'No subscriptions', count: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Format date range for notification
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr)
      return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }

    const dateRange = start_date === end_date
      ? formatDate(start_date)
      : `${formatDate(start_date)} - ${formatDate(end_date)}`

    const payload = JSON.stringify({
      title: change_type === 'available' ? 'Zwolniono termin!' : 'Zablokowano termin',
      body: `${property_name} - ${unit_name}: ${dateRange}`,
      url: `/#/property/${property_id}/units`,
      icon: 'https://cdn-icons-png.flaticon.com/512/2645/2645897.png'
    })

    // Send to all subscriptions
    const results = await Promise.allSettled(
      subscriptions.map(sub =>
        webpush.sendNotification(sub.subscription, payload)
          .catch(async (err) => {
            // If subscription is invalid (410 Gone), remove it from database
            if (err.statusCode === 410) {
              console.log(`Removing invalid subscription: ${sub.endpoint}`)
              await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', sub.endpoint)
            }
            console.error("Push error:", err.statusCode, err.body)
            return null
          })
      )
    )

    const successCount = results.filter(r => r.status === 'fulfilled' && r.value !== null).length
    const failureCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value === null)).length

    console.log(`Push notifications sent: ${successCount} success, ${failureCount} failed`)

    return new Response(JSON.stringify({
      success: true,
      sent: successCount,
      failed: failureCount,
      total: subscriptions.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Push notification error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

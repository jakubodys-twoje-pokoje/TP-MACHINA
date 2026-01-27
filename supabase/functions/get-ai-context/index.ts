import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get notification IDs from query params or body
    const url = new URL(req.url)
    let notificationIds: string[] = []

    if (req.method === 'POST') {
      const body = await req.json()
      notificationIds = body.notification_ids || []
    } else {
      const idsParam = url.searchParams.get('notification_ids')
      notificationIds = idsParam ? idsParam.split(',') : []
    }

    if (notificationIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No notification_ids provided' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`📋 Fetching context for ${notificationIds.length} notifications`)

    // 1. Fetch notifications with property and unit details
    const { data: notifications, error: notifError } = await supabaseClient
      .from('notifications')
      .select(`
        id,
        property_id,
        unit_id,
        property_name,
        unit_name,
        change_type,
        start_date,
        end_date,
        created_at
      `)
      .in('id', notificationIds)
      .order('start_date', { ascending: true })

    if (notifError) {
      throw new Error(`Failed to fetch notifications: ${notifError.message}`)
    }

    if (!notifications || notifications.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No notifications found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      )
    }

    // 2. Get unique property and unit IDs
    const propertyIds = [...new Set(notifications.map(n => n.property_id))]
    const unitIds = [...new Set(notifications.map(n => n.unit_id))]

    console.log(`📊 Processing ${propertyIds.length} properties, ${unitIds.length} units`)

    // 3. Fetch reservation history for these units (last 6 months)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split('T')[0]

    const { data: reservations } = await supabaseClient
      .from('reservations')
      .select('unit_id, check_in, check_out, status, created_at, nights, total_price')
      .in('unit_id', unitIds)
      .gte('check_in', sixMonthsAgoStr)
      .order('check_in', { ascending: false })

    // 4. Fetch current availability for context (next 90 days)
    const today = new Date().toISOString().split('T')[0]
    const in90Days = new Date()
    in90Days.setDate(in90Days.getDate() + 90)
    const in90DaysStr = in90Days.toISOString().split('T')[0]

    const { data: availability } = await supabaseClient
      .from('availability')
      .select('unit_id, date, status')
      .in('unit_id', unitIds)
      .gte('date', today)
      .lte('date', in90DaysStr)

    // 5. Fetch current CTA/CTD/MIN settings
    const { data: currentPrices } = await supabaseClient
      .from('prices')
      .select('unit_id, date, cta, ctd, min, rate_id')
      .in('unit_id', unitIds)
      .gte('date', today)
      .lte('date', in90DaysStr)

    // 6. Fetch units details
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, name, property_id, base_price')
      .in('id', unitIds)

    // 7. Calculate statistics per unit
    const unitStats = new Map()

    for (const unit of units || []) {
      const unitReservations = reservations?.filter(r => r.unit_id === unit.id) || []
      const unitAvailability = availability?.filter(a => a.unit_id === unit.id) || []

      // Calculate lead time (days between booking and check-in)
      const leadTimes = unitReservations
        .filter(r => r.created_at && r.check_in)
        .map(r => {
          const created = new Date(r.created_at)
          const checkin = new Date(r.check_in)
          return Math.floor((checkin.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
        })
        .filter(lt => lt >= 0 && lt < 365) // Filter outliers

      const avgLeadTime = leadTimes.length > 0
        ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length)
        : null

      // Calculate booking patterns
      const weekendBookings = unitReservations.filter(r => {
        const checkin = new Date(r.check_in)
        const day = checkin.getDay()
        return day === 5 || day === 6 // Friday or Saturday check-ins
      }).length

      const weekdayBookings = unitReservations.length - weekendBookings
      const weekendPercentage = unitReservations.length > 0
        ? Math.round((weekendBookings / unitReservations.length) * 100)
        : null

      // Calculate occupancy (next 30 days)
      const next30Days = unitAvailability.filter(a => {
        const date = new Date(a.date)
        const diff = (date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        return diff >= 0 && diff <= 30
      })

      const bookedDays = next30Days.filter(a => a.status === 'blocked').length
      const occupancyRate = next30Days.length > 0
        ? Math.round((bookedDays / next30Days.length) * 100)
        : null

      // Average stay length
      const avgNights = unitReservations.length > 0
        ? Math.round(unitReservations.reduce((sum, r) => sum + (r.nights || 0), 0) / unitReservations.length)
        : null

      unitStats.set(unit.id, {
        unit_id: unit.id,
        unit_name: unit.name,
        property_id: unit.property_id,
        base_price: unit.base_price,
        total_bookings_6m: unitReservations.length,
        avg_lead_time_days: avgLeadTime,
        weekend_booking_percentage: weekendPercentage,
        current_occupancy_30d: occupancyRate,
        avg_stay_nights: avgNights,
        recent_reservations: unitReservations.slice(0, 5).map(r => ({
          check_in: r.check_in,
          check_out: r.check_out,
          nights: r.nights,
          lead_time_days: r.created_at && r.check_in
            ? Math.floor((new Date(r.check_in).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24))
            : null
        }))
      })
    }

    // 8. Organize gaps and current restrictions per notification
    const enrichedNotifications = notifications.map(notif => {
      const unit = units?.find(u => u.id === notif.unit_id)
      const stats = unitStats.get(notif.unit_id)

      // Get surrounding availability (±7 days)
      const notifDate = new Date(notif.start_date)
      const before7 = new Date(notifDate)
      before7.setDate(before7.getDate() - 7)
      const after7 = new Date(notifDate)
      after7.setDate(after7.getDate() + 7)

      const surroundingAvail = availability
        ?.filter(a =>
          a.unit_id === notif.unit_id &&
          new Date(a.date) >= before7 &&
          new Date(a.date) <= after7
        )
        .map(a => ({ date: a.date, status: a.status }))
        .sort((a, b) => a.date.localeCompare(b.date))

      // Current CTA/CTD for this date range
      const currentRestrictions = currentPrices
        ?.filter(p =>
          p.unit_id === notif.unit_id &&
          p.date >= notif.start_date &&
          p.date <= notif.end_date
        )
        .map(p => ({ date: p.date, cta: p.cta, ctd: p.ctd, min: p.min }))

      return {
        ...notif,
        unit_stats: stats,
        surrounding_availability: surroundingAvail || [],
        current_restrictions: currentRestrictions || []
      }
    })

    // 9. Prepare final context
    const context = {
      notifications: enrichedNotifications,
      summary: {
        total_notifications: notifications.length,
        properties_affected: propertyIds.length,
        units_affected: unitIds.length,
        date_range: {
          earliest: notifications[0]?.start_date,
          latest: notifications[notifications.length - 1]?.end_date
        }
      },
      unit_statistics: Array.from(unitStats.values()),
      generated_at: new Date().toISOString()
    }

    console.log(`✅ Context prepared: ${enrichedNotifications.length} notifications enriched`)

    return new Response(
      JSON.stringify(context, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('❌ Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

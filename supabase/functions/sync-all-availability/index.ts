import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Property {
  id: string
  name: string
  hotres_id: string
}

interface AvailabilityItem {
  type_id: string
  dates: Array<{
    date: string
    available: number | string | boolean
  }>
}

// Check if current time is within allowed hours (04:00 - 01:00 Polish time)
function isWithinAllowedHours(): boolean {
  const now = new Date()
  const polandTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' }))
  const hour = polandTime.getHours()

  // Allowed: 04:00 - 01:00 (blocked: 01:00 - 04:00)
  const isAllowed = hour >= 4 || hour < 1

  if (!isAllowed) {
    console.log(`⏸️  Sync paused (downtime 01:00-04:00 Polish time), current hour: ${hour}`)
  }

  return isAllowed
}

function normalizeDate(dateInput: string): string {
  try {
    if (!dateInput) return ''
    if (dateInput.includes('T')) {
      return dateInput.split('T')[0]
    }
    return dateInput.substring(0, 10)
  } catch (e) {
    return String(dateInput).substring(0, 10)
  }
}

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

async function fetchFromHotres(targetUrl: string): Promise<string> {
  // Edge Functions run server-side, so we can directly call Hotres API (no CORS issues)
  const res = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`Hotres API error: ${res.status} ${res.statusText}`)
  }

  const text = await res.text()

  if (!text || text.length === 0) {
    throw new Error('Empty response from Hotres API')
  }

  return text
}

async function syncPropertyAvailability(
  property: Property,
  supabaseClient: any
): Promise<void> {
  const apiUser = "admin@twojepokoje.com.pl"
  const apiPass = "Admin123@@"
  const oid = property.hotres_id

  await supabaseClient
    .from('properties')
    .update({ availability_sync_in_progress: true })
    .eq('id', property.id)

  try {
    // Fetch units for this property
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, name, external_id, external_type_id')
      .eq('property_id', property.id)

    if (!units || units.length === 0) {
      throw new Error("No units found for property")
    }

    // Build unit mapping
    const unitMap = new Map<string, string>()
    units.forEach((u: any) => {
      if (u.external_id) unitMap.set(String(u.external_id).trim(), u.id)
      if (u.external_type_id) unitMap.set(String(u.external_type_id).trim(), u.id)
    })

    // Fetch availability from Hotres API
    const year = 2026
    const fromDate = `${year}-01-01`
    const tillDate = `${year}-12-31`

    const targetUrl = `https://panel.hotres.pl/api_availability?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&from=${fromDate}&till=${tillDate}`
    const rawResponse = await fetchFromHotres(targetUrl)

    // Parse response
    const jsonText = rawResponse.trim().replace(/^\uFEFF/, '')
    let jsonData: any
    try {
      jsonData = JSON.parse(jsonText)
      if (typeof jsonData === 'string') jsonData = JSON.parse(jsonData)
    } catch (e) {
      throw new Error("Failed to parse Hotres response")
    }

    if (jsonData && jsonData.result === 'error') {
      throw new Error(`Hotres API Error: ${jsonData.message}`)
    }

    // Extract items to process
    let itemsToProcess: any[] = []
    if (Array.isArray(jsonData)) {
      itemsToProcess = jsonData
    } else if (typeof jsonData === 'object' && jsonData !== null) {
      const vals = Object.values(jsonData)
      const foundArr = vals.find(v => Array.isArray(v) && v.length > 0 && ((v as any)[0].type_id || (v as any)[0].dates))
      itemsToProcess = foundArr ? (foundArr as any[]) : vals.filter((v: any) => v && (v.type_id || v.dates))
    }

    // Fetch existing availability records
    const unitIds = units.map((u: any) => u.id)
    const { data: existingRows } = await supabaseClient
      .from('availability')
      .select('id, unit_id, date, status, reservation_id')
      .in('unit_id', unitIds)
      .gte('date', fromDate)
      .lte('date', tillDate)

    const dbMap = new Map<string, any>()
    existingRows?.forEach((row: any) => {
      dbMap.set(`${row.unit_id}_${normalizeDate(row.date)}`, row)
    })

    // Build rows to upsert
    const rowsToUpsert: any[] = []
    const processedKeys = new Set<string>()

    for (const item of itemsToProcess) {
      const extId = String(item.type_id).trim()
      const unitId = unitMap.get(extId)

      if (unitId && item.dates && Array.isArray(item.dates)) {
        for (const d of item.dates) {
          const dateStr = normalizeDate(d.date)
          const key = `${unitId}_${dateStr}`
          if (processedKeys.has(key)) continue
          processedKeys.add(key)

          const isBooked = (d.available === 0 || d.available === '0' || d.available === false)
          const targetStatus = isBooked ? 'booked' : 'available'
          const existingRow = dbMap.get(key)

          rowsToUpsert.push({
            id: existingRow ? existingRow.id : uuidv4(),
            unit_id: unitId,
            date: dateStr,
            status: targetStatus,
            reservation_id: existingRow?.reservation_id || null
          })
        }
      }
    }

    // Upsert in batches
    if (rowsToUpsert.length > 0) {
      const BATCH_SIZE = 500
      for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
        const batch = rowsToUpsert.slice(i, i + BATCH_SIZE)
        const { error: upsertError } = await supabaseClient
          .from('availability')
          .upsert(batch, { onConflict: 'unit_id,date' })
        if (upsertError) throw upsertError
      }
    }

    // Update property sync status
    await supabaseClient
      .from('properties')
      .update({
        availability_last_synced_at: new Date().toISOString(),
        availability_sync_in_progress: false
      })
      .eq('id', property.id)

    console.log(`✓ Synced ${property.name}: ${rowsToUpsert.length} records`)

  } catch (error: any) {
    await supabaseClient
      .from('properties')
      .update({ availability_sync_in_progress: false })
      .eq('id', property.id)

    throw error
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Check time restrictions
    if (!isWithinAllowedHours()) {
      return new Response(
        JSON.stringify({
          message: 'Sync skipped - outside allowed hours (04:00-01:00 Polish time)',
          skipped: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch all properties with hotres_id
    const { data: properties, error: propertiesError } = await supabaseClient
      .from('properties')
      .select('id, name, hotres_id')
      .not('hotres_id', 'is', null)

    if (propertiesError) {
      throw new Error(`Failed to fetch properties: ${propertiesError.message}`)
    }

    if (!properties || properties.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No properties with Hotres ID found', count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    console.log(`🔄 Starting sync for ${properties.length} properties...`)

    // Sync all properties in parallel
    const results = await Promise.allSettled(
      properties.map(property => syncPropertyAvailability(property, supabaseClient))
    )

    // Collect successes and errors
    const successes: Array<{ propertyName: string; propertyId: string }> = []
    const errors: Array<{ propertyName: string; propertyId: string; error: string }> = []

    results.forEach((result, index) => {
      const property = properties[index]
      if (result.status === 'fulfilled') {
        successes.push({
          propertyName: property.name,
          propertyId: property.id
        })
      } else {
        errors.push({
          propertyName: property.name,
          propertyId: property.id,
          error: result.reason?.message || 'Unknown error'
        })
      }
    })

    // Save log to database
    const { error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        success_count: successes.length,
        error_count: errors.length,
        successes: successes,
        errors: errors
      })

    if (logError) {
      console.error('Failed to save sync log:', logError)
    }

    // Clean up old logs (older than 12 hours)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const { error: cleanupError } = await supabaseClient
      .from('sync_logs')
      .delete()
      .lt('created_at', twelveHoursAgo)

    if (cleanupError) {
      console.error('Failed to cleanup old logs:', cleanupError)
    } else {
      console.log(`🧹 Cleaned up logs older than ${twelveHoursAgo}`)
    }

    console.log(`📊 Sync complete: ✓${successes.length} ✗${errors.length}`)

    return new Response(
      JSON.stringify({
        message: 'Sync completed',
        success_count: successes.length,
        error_count: errors.length,
        successes,
        errors
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('Sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

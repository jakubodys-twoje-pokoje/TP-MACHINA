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

interface AvailabilitySnapshot {
  unit_id: string
  date: string
  status: string
}

interface DateRangeChange {
  unitId: string
  unitName: string
  propertyId: string
  propertyName: string
  userId: string
  changeType: 'available' | 'blocked'
  startDate: string
  endDate: string
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

// Group consecutive dates with same change type into ranges
function groupConsecutiveDates(changes: Map<string, { from: string; to: string; date: string }>): Array<{ startDate: string; endDate: string; changeType: 'available' | 'blocked' }> {
  const sortedDates = Array.from(changes.entries())
    .map(([date, change]) => ({ date, from: change.from, to: change.to }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const ranges: Array<{ startDate: string; endDate: string; changeType: 'available' | 'blocked' }> = []

  if (sortedDates.length === 0) return ranges

  let currentRange = {
    startDate: sortedDates[0].date,
    endDate: sortedDates[0].date,
    changeType: (sortedDates[0].to === 'booked' ? 'blocked' : 'available') as 'available' | 'blocked'
  }

  for (let i = 1; i < sortedDates.length; i++) {
    const current = sortedDates[i]
    const prev = sortedDates[i - 1]
    const currentChangeType = (current.to === 'booked' ? 'blocked' : 'available') as 'available' | 'blocked'

    // Check if dates are consecutive (1 day apart)
    const prevDate = new Date(prev.date)
    const currDate = new Date(current.date)
    const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)

    if (dayDiff === 1 && currentChangeType === currentRange.changeType) {
      // Extend current range
      currentRange.endDate = current.date
    } else {
      // Save current range and start new one
      ranges.push({ ...currentRange })
      currentRange = {
        startDate: current.date,
        endDate: current.date,
        changeType: currentChangeType
      }
    }
  }

  // Don't forget the last range
  ranges.push(currentRange)

  return ranges
}

// Detect availability changes and create notifications
async function detectChangesAndNotify(
  supabaseClient: any,
  beforeSnapshot: Map<string, AvailabilitySnapshot>,
  afterSnapshot: Map<string, AvailabilitySnapshot>
): Promise<{ unitsWithChanges: number; notificationsCreated: number }> {
  console.log(`🔍 Detecting changes... Before: ${beforeSnapshot.size}, After: ${afterSnapshot.size}`)

  // Group changes by unit
  const changesByUnit = new Map<string, {
    unitId: string
    unitName: string
    propertyId: string
    propertyName: string
    changes: Map<string, { from: string; to: string; date: string }>
  }>()

  // Compare snapshots to find changes
  for (const [key, afterRecord] of afterSnapshot.entries()) {
    const beforeRecord = beforeSnapshot.get(key)

    if (beforeRecord && beforeRecord.status !== afterRecord.status) {
      // Status changed!
      const unitKey = afterRecord.unit_id

      if (!changesByUnit.has(unitKey)) {
        // Fetch unit and property details
        const { data: unitData } = await supabaseClient
          .from('units')
          .select('id, name, property_id, properties(id, name)')
          .eq('id', afterRecord.unit_id)
          .single()

        if (unitData && unitData.properties) {
          changesByUnit.set(unitKey, {
            unitId: unitData.id,
            unitName: unitData.name,
            propertyId: unitData.properties.id,
            propertyName: unitData.properties.name,
            changes: new Map()
          })
        }
      }

      const unitChanges = changesByUnit.get(unitKey)
      if (unitChanges) {
        unitChanges.changes.set(afterRecord.date, {
          from: beforeRecord.status,
          to: afterRecord.status,
          date: afterRecord.date
        })
      }
    }
  }

  const unitsWithChanges = changesByUnit.size
  console.log(`📊 Found changes in ${unitsWithChanges} units`)

  // Create notifications for each unit's date ranges
  const notifications: any[] = []

  for (const [unitId, unitData] of changesByUnit.entries()) {
    const ranges = groupConsecutiveDates(unitData.changes)

    for (const range of ranges) {
      notifications.push({
        property_id: unitData.propertyId,
        unit_id: unitData.unitId,
        property_name: unitData.propertyName,
        unit_name: unitData.unitName,
        change_type: range.changeType,
        start_date: range.startDate,
        end_date: range.endDate,
        is_read: false
      })
    }
  }

  // Insert notifications in batches
  let notificationsCreated = 0
  if (notifications.length > 0) {
    const BATCH_SIZE = 100
    for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
      const batch = notifications.slice(i, i + BATCH_SIZE)
      const { error } = await supabaseClient
        .from('notifications')
        .insert(batch)

      if (error) {
        console.error('Failed to insert notifications:', error)
      } else {
        notificationsCreated += batch.length

        // Send push notifications for each notification in batch
        for (const notification of batch) {
          try {
            await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
              },
              body: JSON.stringify({
                property_id: notification.property_id,
                unit_id: notification.unit_id,
                property_name: notification.property_name,
                unit_name: notification.unit_name,
                change_type: notification.change_type,
                start_date: notification.start_date,
                end_date: notification.end_date
              })
            })
            console.log(`📲 Push notification sent for ${notification.property_name} - ${notification.unit_name}`)
          } catch (pushError) {
            console.error('Failed to send push notification:', pushError)
            // Continue even if push fails
          }
        }
      }
    }
    console.log(`✅ Created ${notificationsCreated} notifications`)
  }

  return { unitsWithChanges, notificationsCreated }
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

    // Take snapshot of current availability state BEFORE syncing
    const beforeSnapshot = new Map<string, AvailabilitySnapshot>()

    // Fetch ALL availability records using pagination
    // NOTE: Supabase has a hard limit of 1000 records per request, so we need many requests
    let beforePage = 0
    const pageSize = 1000  // Maximum allowed by Supabase
    let hasMoreBefore = true

    console.log(`🔍 [DEBUG] Starting pagination with pageSize=${pageSize}`)

    while (hasMoreBefore) {
      const rangeStart = beforePage * pageSize
      const rangeEnd = rangeStart + pageSize - 1
      console.log(`🔍 [DEBUG] Fetching page ${beforePage}, range: ${rangeStart}-${rangeEnd}`)

      const { data: beforeData, error: beforeError } = await supabaseClient
        .from('availability')
        .select('unit_id, date, status')
        .gte('date', '2026-01-01')
        .lte('date', '2026-12-31')
        .order('unit_id')
        .order('date')
        .range(rangeStart, rangeEnd)

      if (beforeError) {
        console.error(`❌ [DEBUG] Error fetching page ${beforePage}:`, beforeError)
        hasMoreBefore = false
        continue
      }

      console.log(`📦 [DEBUG] Page ${beforePage}: received ${beforeData?.length || 0} records, total so far: ${beforeSnapshot.size}`)

      if (beforeData && beforeData.length > 0) {
        beforeData.forEach((record: any) => {
          const key = `${record.unit_id}_${record.date}`
          beforeSnapshot.set(key, {
            unit_id: record.unit_id,
            date: record.date,
            status: record.status
          })
        })

        if (beforeData.length < pageSize) {
          console.log(`✅ [DEBUG] Last page reached (${beforeData.length} < ${pageSize})`)
          hasMoreBefore = false
        } else {
          beforePage++
        }
      } else {
        console.log(`⚠️ [DEBUG] Empty page, stopping pagination`)
        hasMoreBefore = false
      }
    }

    console.log(`✅ [DEBUG] Pagination complete: ${beforePage + 1} pages, ${beforeSnapshot.size} total records`)

    console.log(`📸 Before snapshot: ${beforeSnapshot.size} records`)

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

    // Take snapshot AFTER syncing to detect changes
    const afterSnapshot = new Map<string, AvailabilitySnapshot>()

    // Fetch ALL availability records (not just 1000) using pagination
    let afterPage = 0
    let hasMoreAfter = true

    console.log(`🔍 [DEBUG] Starting AFTER pagination with pageSize=${pageSize}`)

    while (hasMoreAfter) {
      const rangeStart = afterPage * pageSize
      const rangeEnd = (afterPage + 1) * pageSize - 1
      console.log(`🔍 [DEBUG] AFTER - Fetching page ${afterPage}, range: ${rangeStart}-${rangeEnd}`)

      const { data: afterData, error: afterError } = await supabaseClient
        .from('availability')
        .select('unit_id, date, status', { count: 'exact' })
        .gte('date', '2026-01-01')
        .lte('date', '2026-12-31')
        .order('unit_id')
        .order('date')
        .range(rangeStart, rangeEnd)
        .limit(pageSize)

      if (afterError) {
        console.error(`❌ [DEBUG] AFTER - Error fetching page ${afterPage}:`, afterError)
        hasMoreAfter = false
        continue
      }

      console.log(`📦 [DEBUG] AFTER - Page ${afterPage}: received ${afterData?.length || 0} records, total so far: ${afterSnapshot.size}`)

      if (afterData && afterData.length > 0) {
        afterData.forEach((record: any) => {
          const key = `${record.unit_id}_${record.date}`
          afterSnapshot.set(key, {
            unit_id: record.unit_id,
            date: record.date,
            status: record.status
          })
        })

        if (afterData.length < pageSize) {
          console.log(`✅ [DEBUG] AFTER - Last page reached (${afterData.length} < ${pageSize})`)
          hasMoreAfter = false
        } else {
          afterPage++
        }
      } else {
        console.log(`⚠️ [DEBUG] AFTER - Empty page, stopping pagination`)
        hasMoreAfter = false
      }
    }

    console.log(`✅ [DEBUG] AFTER - Pagination complete: ${afterPage + 1} pages, ${afterSnapshot.size} total records`)

    console.log(`📸 After snapshot: ${afterSnapshot.size} records`)

    // Detect changes and create notifications
    const detectionStats = await detectChangesAndNotify(supabaseClient, beforeSnapshot, afterSnapshot)

    // Save log to database with detection statistics
    const { error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        success_count: successes.length,
        error_count: errors.length,
        successes: successes,
        errors: errors,
        records_compared: afterSnapshot.size,
        units_with_changes: detectionStats.unitsWithChanges,
        notifications_created: detectionStats.notificationsCreated
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

    // Clean up old notifications (older than 14 days)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
    const { error: notifCleanupError } = await supabaseClient
      .from('notifications')
      .delete()
      .lt('created_at', fourteenDaysAgo)

    if (notifCleanupError) {
      console.error('Failed to cleanup old notifications:', notifCleanupError)
    } else {
      console.log(`🧹 Cleaned up notifications older than ${fourteenDaysAgo}`)
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

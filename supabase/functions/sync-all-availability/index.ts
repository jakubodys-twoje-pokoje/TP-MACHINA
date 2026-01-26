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
): Promise<{ recordsCompared: number; changesDetected: number; notificationsSent: number }> {
  const apiUser = "admin@twojepokoje.com.pl"
  const apiPass = "Admin123@@"
  const oid = property.hotres_id

  // Initialize metrics tracking
  let recordsCompared = 0
  let changesDetected = 0
  let notificationsSent = 0

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

    // Build unit mapping using ONLY external_type_id to avoid duplicates
    // external_type_id is the primary identifier used by Hotres API
    const unitMap = new Map<string, string>()
    const unitNamesMap = new Map<string, string>()
    units.forEach((u: any) => {
      if (u.external_type_id) {
        const typeId = String(u.external_type_id).trim()
        unitMap.set(typeId, u.id)
        unitNamesMap.set(typeId, u.name)
        console.log(`  Mapped type_id ${typeId} → ${u.name} (${u.id})`)
      } else {
        console.warn(`  ⚠️  Unit ${u.name} missing external_type_id`)
      }
    })

    console.log(`📋 ${property.name}: ${units.length} units in database`)
    console.log(`📋 Unit mapping keys:`, Array.from(unitMap.keys()).join(', '))

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

    // Fetch existing availability records (BEFORE snapshot for this property)
    const unitIds = units.map((u: any) => u.id)
    const { data: existingRows } = await supabaseClient
      .from('availability')
      .select('id, unit_id, date, status, reservation_id')
      .in('unit_id', unitIds)
      .gte('date', fromDate)
      .lte('date', tillDate)

    const dbMap = new Map<string, any>()
    const beforePropertySnapshot = new Map<string, { status: string }>()
    existingRows?.forEach((row: any) => {
      const key = `${row.unit_id}_${normalizeDate(row.date)}`
      dbMap.set(key, row)
      beforePropertySnapshot.set(key, { status: row.status })
    })

    // Track API type_ids for diagnostics
    const apiTypeIds = new Set<string>()
    const matchedTypeIds = new Set<string>()
    const unmatchedTypeIds = new Set<string>()

    // Track per-unit metrics
    const unitMetrics = new Map<string, { unitName: string; daysFetched: number; recordsCompared: number }>()

    // Build rows to upsert
    const rowsToUpsert: any[] = []
    const processedKeys = new Set<string>()

    for (const item of itemsToProcess) {
      const extId = String(item.type_id).trim()
      apiTypeIds.add(extId)
      const unitId = unitMap.get(extId)

      if (unitId && item.dates && Array.isArray(item.dates)) {
        matchedTypeIds.add(extId)

        // Initialize unit metrics if not exists
        if (!unitMetrics.has(unitId)) {
          const unitName = unitNamesMap.get(extId) || 'Unknown'
          unitMetrics.set(unitId, { unitName, daysFetched: 0, recordsCompared: 0 })
        }

        for (const d of item.dates) {
          recordsCompared++ // Count each date record from API
          const dateStr = normalizeDate(d.date)
          const key = `${unitId}_${dateStr}`
          if (processedKeys.has(key)) continue
          processedKeys.add(key)

          // Track per-unit metrics
          const metrics = unitMetrics.get(unitId)!
          metrics.daysFetched++
          metrics.recordsCompared++

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
      } else if (!unitId) {
        // Track unmatched type_ids for diagnostics
        unmatchedTypeIds.add(extId)
      }
    }

    // Report diagnostics
    console.log(`📊 ${property.name} API Statistics:`)
    console.log(`   - API returned ${apiTypeIds.size} distinct type_ids`)
    console.log(`   - Matched ${matchedTypeIds.size} type_ids to database units`)
    console.log(`   - Unmatched ${unmatchedTypeIds.size} type_ids`)

    if (unmatchedTypeIds.size > 0) {
      console.log(`⚠️  UNMATCHED type_ids from API:`, Array.from(unmatchedTypeIds).join(', '))
      console.log(`⚠️  Expected type_ids from DB:`, Array.from(unitMap.keys()).join(', '))

      // Try to find similar IDs (case-insensitive, spaces removed)
      const normalizedDbKeys = new Map<string, string>()
      unitMap.forEach((value, key) => {
        const normalized = key.toLowerCase().replace(/\s+/g, '')
        normalizedDbKeys.set(normalized, key)
      })

      const suggestions: string[] = []
      unmatchedTypeIds.forEach(unmatchedId => {
        const normalized = unmatchedId.toLowerCase().replace(/\s+/g, '')
        const dbKey = normalizedDbKeys.get(normalized)
        if (dbKey) {
          suggestions.push(`  "${unmatchedId}" might match "${dbKey}" (case/space mismatch)`)
        }
      })

      if (suggestions.length > 0) {
        console.log(`💡 Possible matches (with normalization):`)
        suggestions.forEach(s => console.log(s))
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

    // Take AFTER snapshot for this property to detect changes
    const { data: afterRows } = await supabaseClient
      .from('availability')
      .select('unit_id, date, status')
      .in('unit_id', unitIds)
      .gte('date', fromDate)
      .lte('date', tillDate)

    const afterPropertySnapshot = new Map<string, { status: string }>()
    afterRows?.forEach((row: any) => {
      const key = `${row.unit_id}_${normalizeDate(row.date)}`
      afterPropertySnapshot.set(key, { status: row.status })
    })

    // Detect changes by comparing before and after snapshots
    const propertyChanges: Array<{
      unitId: string
      date: string
      fromStatus: string
      toStatus: string
    }> = []

    // Track changes per unit for metrics
    const unitChangeCounts = new Map<string, number>()

    for (const [key, afterRecord] of afterPropertySnapshot.entries()) {
      const beforeRecord = beforePropertySnapshot.get(key)
      if (beforeRecord && beforeRecord.status !== afterRecord.status) {
        changesDetected++
        const [unitId, date] = key.split('_')
        propertyChanges.push({
          unitId,
          date,
          fromStatus: beforeRecord.status,
          toStatus: afterRecord.status
        })

        // Track changes per unit
        unitChangeCounts.set(unitId, (unitChangeCounts.get(unitId) || 0) + 1)
      }
    }

    // Group changes by unit and send notifications
    const changesByUnit = new Map<string, Array<{ date: string; fromStatus: string; toStatus: string }>>()
    for (const change of propertyChanges) {
      if (!changesByUnit.has(change.unitId)) {
        changesByUnit.set(change.unitId, [])
      }
      changesByUnit.get(change.unitId)!.push({
        date: change.date,
        fromStatus: change.fromStatus,
        toStatus: change.toStatus
      })
    }

    // Create and send notifications for this property
    for (const [unitId, changes] of changesByUnit.entries()) {
      // Fetch unit details
      const { data: unitData } = await supabaseClient
        .from('units')
        .select('id, name, property_id, properties(id, name)')
        .eq('id', unitId)
        .single()

      if (!unitData || !unitData.properties) continue

      // Group consecutive dates into ranges
      const sortedChanges = changes.sort((a, b) => a.date.localeCompare(b.date))
      const ranges: Array<{ startDate: string; endDate: string; changeType: 'available' | 'blocked' }> = []

      let currentRange: { startDate: string; endDate: string; changeType: 'available' | 'blocked' } | null = null

      for (const change of sortedChanges) {
        const changeType = change.toStatus === 'booked' ? 'blocked' : 'available'

        if (!currentRange) {
          currentRange = { startDate: change.date, endDate: change.date, changeType }
        } else {
          const prevDate = new Date(currentRange.endDate)
          const currDate = new Date(change.date)
          const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)

          if (dayDiff === 1 && changeType === currentRange.changeType) {
            currentRange.endDate = change.date
          } else {
            ranges.push({ ...currentRange })
            currentRange = { startDate: change.date, endDate: change.date, changeType }
          }
        }
      }

      if (currentRange) {
        ranges.push(currentRange)
      }

      // Create notifications and send push notifications
      for (const range of ranges) {
        const notificationData = {
          property_id: unitData.properties.id,
          unit_id: unitData.id,
          property_name: unitData.properties.name,
          unit_name: unitData.name,
          change_type: range.changeType,
          start_date: range.startDate,
          end_date: range.endDate,
          is_read: false
        }

        // Insert notification
        const { error: notifError } = await supabaseClient
          .from('notifications')
          .insert(notificationData)

        if (notifError) {
          console.error('Failed to create notification:', notifError)
          continue
        }

        // Send push notification
        try {
          const pushResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
            },
            body: JSON.stringify({
              property_id: notificationData.property_id,
              unit_id: notificationData.unit_id,
              property_name: notificationData.property_name,
              unit_name: notificationData.unit_name,
              change_type: notificationData.change_type,
              start_date: notificationData.start_date,
              end_date: notificationData.end_date
            })
          })

          if (pushResponse.ok) {
            notificationsSent++
            console.log(`📲 Push sent for ${notificationData.property_name} - ${notificationData.unit_name}`)
          }
        } catch (pushError) {
          console.error('Failed to send push notification:', pushError)
        }
      }
    }

    console.log(`📊 ${property.name} Metrics: ${recordsCompared} compared, ${changesDetected} changes, ${notificationsSent} push sent`)

    // Update property sync status
    await supabaseClient
      .from('properties')
      .update({
        availability_last_synced_at: new Date().toISOString(),
        availability_sync_in_progress: false
      })
      .eq('id', property.id)

    console.log(`✓ Synced ${property.name}: ${rowsToUpsert.length} records`)

    // Save sync history for this property
    const { data: syncHistory, error: syncHistoryError } = await supabaseClient
      .from('sync_history')
      .insert({
        property_id: property.id,
        property_name: property.name,
        records_compared: recordsCompared,
        changes_detected: changesDetected,
        notifications_sent: notificationsSent,
        status: 'success'
      })
      .select()
      .single()

    if (syncHistoryError) {
      console.error('Failed to save sync history:', syncHistoryError)
    } else if (syncHistory && unitMetrics.size > 0) {
      // Save per-unit details
      console.log(`📊 Preparing to save details for ${unitMetrics.size} units`)
      const unitDetails = Array.from(unitMetrics.entries()).map(([unitId, metrics]) => ({
        sync_history_id: syncHistory.id,
        property_id: property.id,
        unit_id: unitId,
        unit_name: metrics.unitName,
        days_fetched: metrics.daysFetched,
        records_compared: metrics.recordsCompared,
        changes_detected: unitChangeCounts.get(unitId) || 0
      }))

      console.log(`📊 Unit details to insert:`, JSON.stringify(unitDetails, null, 2))

      const { data: insertedDetails, error: detailsError } = await supabaseClient
        .from('sync_unit_details')
        .insert(unitDetails)
        .select()

      if (detailsError) {
        console.error('❌ Failed to save unit details:', detailsError)
        console.error('   Error code:', detailsError.code)
        console.error('   Error message:', detailsError.message)
        console.error('   Error details:', detailsError.details)
      } else {
        console.log(`✓ Successfully saved details for ${insertedDetails?.length || unitDetails.length} units`)
      }
    } else {
      console.log(`⚠️  No unit details to save (syncHistory: ${!!syncHistory}, unitMetrics.size: ${unitMetrics.size})`)
    }

    return { recordsCompared, changesDetected, notificationsSent }

  } catch (error: any) {
    // Save error to sync history
    await supabaseClient
      .from('sync_history')
      .insert({
        property_id: property.id,
        property_name: property.name,
        records_compared: recordsCompared,
        changes_detected: changesDetected,
        notifications_sent: notificationsSent,
        status: 'error',
        error_message: error.message || 'Unknown error'
      })

    await supabaseClient
      .from('properties')
      .update({ availability_sync_in_progress: false })
      .eq('id', property.id)

    throw error
  }
}

// Sync prices/restrictions for a single property
async function syncPropertyPrices(property: Property, supabaseClient: any): Promise<{ recordsCompared: number; changesDetected: number; notificationsSent: number }> {
  try {
    console.log(`💰 Syncing prices for ${property.name} (${property.id})...`)

    const oid = property.hotres_id
    const apiUser = 'admin@twojepokoje.com.pl'
    const apiPass = 'Admin123@@'

    // Get units for this property
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, external_type_id')
      .eq('property_id', property.id)
      .not('external_type_id', 'is', null)

    if (!units || units.length === 0) {
      console.log(`  No units with external_type_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0, notificationsSent: 0 }
    }

    // Get ALL rate plans for this property
    const { data: allRatePlans, error: ratePlansError } = await supabaseClient
      .from('rate_plans')
      .select('id, external_id, name')
      .eq('property_id', property.id)
      .not('external_id', 'is', null)

    if (!allRatePlans || allRatePlans.length === 0) {
      console.log(`  ⚠️ No rate plans with external_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0, notificationsSent: 0 }
    }

    // Prefer "Booking" rate plan, but use first available if "Booking" doesn't exist
    const bookingPlan = allRatePlans.find(rp => rp.name.toLowerCase().includes('booking'))
    const targetRatePlan = bookingPlan || allRatePlans[0]

    console.log(`  📋 Rate plans for ${property.name}:`, {
      total: allRatePlans.length,
      using: `"${targetRatePlan.name}" (id: ${targetRatePlan.id}, ext_id: ${targetRatePlan.external_id})`,
      all: allRatePlans.map(rp => rp.name)
    })

    // Fetch prices from Hotres - fixed date range: 20.01.2026 to 31.12.2026
    const fromDate = '2026-01-20'
    const tillDate = '2026-12-31'
    const targetRatePlanId = targetRatePlan.id
    const targetRateExternalId = targetRatePlan.external_id

    console.log(`  📅 Fetching prices from ${fromDate} to ${tillDate}`)
    console.log(`  🔄 Will fetch prices for ${units.length} units (rate_id: ${targetRateExternalId})`)

    // Collect all price records
    const pricesByUnitDate = new Map<string, any>()
    let successfulFetches = 0
    let failedFetches = 0

    // Fetch prices for each unit separately (API requires type_id + rate_id)
    for (const unit of units) {
      const typeId = unit.external_type_id

      try {
        const pricesUrl = `https://panel.hotres.pl/api_prices?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&type_id=${typeId}&rate_id=${targetRateExternalId}&from=${fromDate}&till=${tillDate}`

        const rawResponse = await fetchFromHotres(pricesUrl)
        const pricesData = JSON.parse(rawResponse)

        // Hotres returns single object with dates array (not array of objects)
        if (pricesData && pricesData.dates && Array.isArray(pricesData.dates)) {
          for (const d of pricesData.dates) {
            const key = `${unit.id}:${d.date}`

            // Store price data
            if (!pricesByUnitDate.has(key)) {
              pricesByUnitDate.set(key, {
                unit_id: unit.id,
                rate_id: targetRatePlanId,
                date: d.date,
                price: d.price ? parseFloat(d.price) : null,
                min: d.min ? parseInt(d.min) : null,
                max: d.max ? parseInt(d.max) : null,
                cta: d.cta !== null && d.cta !== undefined ? parseInt(d.cta) : null,
                ctd: d.ctd !== null && d.ctd !== undefined ? parseInt(d.ctd) : null
              })
            }
          }

          successfulFetches++
        } else {
          failedFetches++
        }
      } catch (error: any) {
        console.error(`  ❌ Failed to fetch prices for type_id ${typeId}:`, error.message)
        failedFetches++
      }
    }

    console.log(`  📊 Fetch summary: ✓${successfulFetches} success, ✗${failedFetches} failed`)

    const pricesToUpsert = Array.from(pricesByUnitDate.values())
    console.log(`  📦 Collected ${pricesToUpsert.length} unique price records (unit+date combinations)`)

    // Show sample records with CTA/CTD/MIN
    const samplesWithRestrictions = pricesToUpsert.filter(p =>
      p.cta !== null || p.ctd !== null || p.min !== null
    ).slice(0, 3)
    if (samplesWithRestrictions.length > 0) {
      console.log(`  📊 Sample records with CTA/CTD/MIN:`, samplesWithRestrictions)
    }

    // Upsert prices
    if (pricesToUpsert.length > 0) {
      const BATCH_SIZE = 500
      let upsertedCount = 0
      for (let i = 0; i < pricesToUpsert.length; i += BATCH_SIZE) {
        const batch = pricesToUpsert.slice(i, i + BATCH_SIZE)
        const { data, error } = await supabaseClient
          .from('prices')
          .upsert(batch, { onConflict: 'unit_id,rate_id,date' })
          .select('id')
        if (error) {
          console.error(`  ❌ Error upserting prices batch ${i}-${i + batch.length}:`, error)
        } else {
          upsertedCount += batch.length
          console.log(`  ✓ Upserted batch ${i}-${i + batch.length} (${batch.length} records)`)
        }
      }
      console.log(`  ✅ Synced ${upsertedCount} price records for ${property.name}`)
    } else {
      console.log(`  ⚠️ No price records to upsert for ${property.name}`)
    }

    return { recordsCompared: 0, changesDetected: 0, notificationsSent: 0 }
  } catch (error: any) {
    console.error(`❌ Error syncing prices for ${property.name}:`, error.message)
    console.error(`❌ Stack trace:`, error.stack)
    console.error(`❌ Full error:`, JSON.stringify(error, null, 2))
    return { recordsCompared: 0, changesDetected: 0, notificationsSent: 0 }
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

    // Sync availability and prices for all properties in parallel
    const results = await Promise.allSettled(
      properties.flatMap(property => [
        syncPropertyAvailability(property, supabaseClient),
        syncPropertyPrices(property, supabaseClient)
      ])
    )

    // Collect successes, errors, and aggregate metrics
    // Track success/error per property (we have 2 tasks per property)
    const propertyResults = new Map<string, { success: number; errors: string[] }>()
    let totalRecordsCompared = 0
    let totalChangesDetected = 0
    let totalNotificationsSent = 0

    // Process results - we have 2 results per property (availability + prices)
    results.forEach((result, index) => {
      const propertyIndex = Math.floor(index / 2)
      const property = properties[propertyIndex]

      if (!propertyResults.has(property.id)) {
        propertyResults.set(property.id, { success: 0, errors: [] })
      }

      const propertyResult = propertyResults.get(property.id)!

      if (result.status === 'fulfilled') {
        propertyResult.success++
        totalRecordsCompared += result.value.recordsCompared
        totalChangesDetected += result.value.changesDetected
        totalNotificationsSent += result.value.notificationsSent
      } else {
        propertyResult.errors.push(result.reason?.message || 'Unknown error')
      }
    })

    // Convert to successes/errors arrays
    const successes: Array<{ propertyName: string; propertyId: string }> = []
    const errors: Array<{ propertyName: string; propertyId: string; error: string }> = []

    properties.forEach(property => {
      const result = propertyResults.get(property.id)
      if (result) {
        if (result.success > 0 && result.errors.length === 0) {
          // Both tasks succeeded
          successes.push({
            propertyName: property.name,
            propertyId: property.id
          })
        } else if (result.errors.length > 0) {
          // At least one task failed
          errors.push({
            propertyName: property.name,
            propertyId: property.id,
            error: result.errors.join('; ')
          })
        }
      }
    })

    // Save global log to database with aggregated statistics
    const { error: logError } = await supabaseClient
      .from('sync_logs')
      .insert({
        success_count: successes.length,
        error_count: errors.length,
        successes: successes,
        errors: errors,
        records_compared: totalRecordsCompared,
        units_with_changes: totalChangesDetected,
        notifications_created: totalNotificationsSent
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

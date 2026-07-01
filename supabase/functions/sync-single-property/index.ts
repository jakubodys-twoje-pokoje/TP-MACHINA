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

// Parse an integer restriction value (min/max/cta/ctd) from the Hotres API.
// Treats '' / null / undefined as null, parses with radix 10, rejects NaN,
// and PRESERVES 0 (cta:0 / ctd:0 / min:0 are valid values, not "missing").
function parseIntOrNull(value: any): number | null {
  if (value === '' || value === null || value === undefined) return null
  const n = parseInt(String(value), 10)
  return Number.isNaN(n) ? null : n
}

// Parse a float price value: '' / null / undefined / NaN → null.
function parseFloatOrNull(value: any): number | null {
  if (value === '' || value === null || value === undefined) return null
  const n = parseFloat(String(value))
  return Number.isNaN(n) ? null : n
}

// Hotres' api_prices caps a single response at 5000 rows ({"result":"error",
// "message":"The maximum result rows is 5000"} — an HTTP 404, not an empty
// body). The row count scales with (days in range × units in the property),
// and how "dense" the rate plan's configured prices are, so a fixed date
// split (e.g. two ~180-day halves) works for small/sparse properties but
// fails for larger ones or densely-configured cenniki. Split the full range
// into chunks sized so days × unitCount stays safely under the cap,
// regardless of property size or how much data a given rate plan has.
function buildDateRangeChunks(startDate: string, endDate: string, unitCount: number): Array<{ from: string; till: string; label: string }> {
  const HOTRES_MAX_ROWS = 5000
  const SAFETY_FACTOR = 0.6 // stay well under the hard cap
  const maxDaysPerChunk = Math.max(7, Math.floor((HOTRES_MAX_ROWS * SAFETY_FACTOR) / Math.max(unitCount, 1)))

  const chunks: Array<{ from: string; till: string; label: string }> = []
  let cursor = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  let index = 1

  while (cursor <= end) {
    const chunkEnd = new Date(cursor)
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDaysPerChunk - 1)
    if (chunkEnd > end) chunkEnd.setTime(end.getTime())

    chunks.push({
      from: cursor.toISOString().split('T')[0],
      till: chunkEnd.toISOString().split('T')[0],
      label: `chunk ${index}`
    })

    index++
    cursor = new Date(chunkEnd)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return chunks
}

async function fetchFromHotres(targetUrl: string): Promise<string> {
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

// Sync availability for a single property
async function syncPropertyAvailability(property: Property, supabaseClient: any): Promise<{ recordsCompared: number; changesDetected: number }> {
  try {
    console.log(`🔄 Syncing availability for ${property.name} (${property.id})...`)

    const oid = property.hotres_id
    const apiUser = 'admin@twojepokoje.com.pl'
    const apiPass = 'Admin123@@'

    // Get units for this property
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, name, external_type_id')
      .eq('property_id', property.id)
      .not('external_type_id', 'is', null)

    if (!units || units.length === 0) {
      console.log(`  ⚠️ No units with external_type_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  📊 Found ${units.length} units for ${property.name}`)

    // Fixed date range: 20.01.2026 to 31.12.2026
    const fromDate = '2026-01-20'
    const tillDate = '2026-12-31'

    const availUrl = `https://panel.hotres.pl/api_availability?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&from=${fromDate}&till=${tillDate}`

    console.log(`  📅 Fetching availability from ${fromDate} to ${tillDate}`)

    const rawResponse = await fetchFromHotres(availUrl)
    const availData = JSON.parse(rawResponse)

    if (!Array.isArray(availData)) {
      console.log(`  ❌ Invalid availability response (not an array)`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  ✓ Hotres API returned ${availData.length} units`)

    // Create mapping: external_type_id -> unit
    const unitMap = new Map<string, any>()
    units.forEach(u => {
      if (u.external_type_id) {
        unitMap.set(String(u.external_type_id).trim(), u)
      }
    })

    // Process availability data
    const rowsToUpsert: any[] = []

    for (const item of availData) {
      const typeId = String(item.type_id).trim()
      const unit = unitMap.get(typeId)

      if (!unit) continue

      if (item.dates && Array.isArray(item.dates)) {
        for (const d of item.dates) {
          const date = normalizeDate(d.date)
          const available = d.available

          let status = 'blocked'
          if (available === 1 || available === '1' || available === true) {
            status = 'available'
          }

          rowsToUpsert.push({
            unit_id: unit.id,
            date: date,
            status: status,
          })
        }
      }
    }

    console.log(`  📦 Collected ${rowsToUpsert.length} availability records`)

    // Upsert to database
    if (rowsToUpsert.length > 0) {
      const BATCH_SIZE = 1000
      let upsertedCount = 0

      for (let i = 0; i < rowsToUpsert.length; i += BATCH_SIZE) {
        const batch = rowsToUpsert.slice(i, i + BATCH_SIZE)
        const { error } = await supabaseClient
          .from('availability')
          .upsert(batch, { onConflict: 'unit_id,date' })

        if (error) {
          console.error(`  ❌ Error upserting availability batch ${i}-${i + batch.length}:`, error)
        } else {
          upsertedCount += batch.length
        }
      }

      console.log(`  ✅ Synced ${upsertedCount} availability records for ${property.name}`)
    }

    return { recordsCompared: rowsToUpsert.length, changesDetected: 0 }
  } catch (error: any) {
    console.error(`❌ Error syncing availability for ${property.name}:`, error.message)
    console.error(`❌ Stack trace:`, error.stack)
    return { recordsCompared: 0, changesDetected: 0 }
  }
}

// Sync prices/restrictions for a single property
async function syncPropertyPrices(property: Property, supabaseClient: any): Promise<{ recordsCompared: number; changesDetected: number }> {
  try {
    console.log(`💰 Syncing prices for ${property.name} (${property.id})...`)

    const oid = property.hotres_id
    const apiUser = 'admin@twojepokoje.com.pl'
    const apiPass = 'Admin123@@'

    // Get units for this property
    const { data: units } = await supabaseClient
      .from('units')
      .select('id, external_type_id, selected_rate_plan_id')
      .eq('property_id', property.id)
      .not('external_type_id', 'is', null)

    if (!units || units.length === 0) {
      console.log(`  ⚠️ No units with external_type_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  📊 Found ${units.length} units`)

    // Need the property's full rate plan list (ordered by name) to know the
    // "default" one — the frontend (RatePlanMatrixModal / CalendarView) falls
    // back to the first rate plan by name whenever a unit has no explicit
    // selected_rate_plan_id, so that's what actually ends up displayed for
    // it. If we only synced explicitly-selected plans, a property where
    // nobody has ever clicked a radio button (e.g. one with a single
    // cennik, where the fallback already looks "selected" in the UI) would
    // never sync at all, even manually.
    const { data: allPropertyRatePlans } = await supabaseClient
      .from('rate_plans')
      .select('id, external_id, name')
      .eq('property_id', property.id)
      .not('external_id', 'is', null)
      .order('name')

    if (!allPropertyRatePlans || allPropertyRatePlans.length === 0) {
      console.log(`  ⚠️ No rate plans with external_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    const defaultRatePlanId = allPropertyRatePlans[0].id
    const hasUnselectedUnits = units.some((u: any) => !u.selected_rate_plan_id)

    const ratePlanIdsToSync = new Set(
      units.map((u: any) => u.selected_rate_plan_id).filter((id: any) => id)
    )
    if (hasUnselectedUnits) ratePlanIdsToSync.add(defaultRatePlanId)

    const allRatePlans = allPropertyRatePlans.filter((rp: any) => ratePlanIdsToSync.has(rp.id))

    if (allRatePlans.length === 0) {
      console.log(`  ⚠️ No matching rate plans with external_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  📋 Rate plans for ${property.name}: ${allRatePlans.length} of ${allPropertyRatePlans.length} configured — syncing explicitly-selected + default fallback (${hasUnselectedUnits ? 'has unselected units' : 'all units have a selection'})`)
    console.log(`  📋 Plans:`, allRatePlans.map(rp => `"${rp.name}" (ext_id: ${rp.external_id})`))

    // Fetch prices from Hotres — split into chunks sized to stay under its
    // 5000-row-per-request cap (see buildDateRangeChunks for why a fixed
    // two-range split isn't reliable across property sizes / rate plan density).
    const dateRanges = buildDateRangeChunks('2026-01-20', '2026-12-31', units.length)
    console.log(`  🔪 Split 2026-01-20..2026-12-31 into ${dateRanges.length} chunk(s) for ${units.length} units`)

    // Create mapping of type_id to unit for lookup (trim to match availability sync
    // and guard against stray whitespace in external_type_id / Hotres type_id)
    const unitMapByTypeId = new Map<string, any>()
    units.forEach(u => {
      if (u.external_type_id) {
        unitMapByTypeId.set(String(u.external_type_id).trim(), u)
      }
    })

    // Collect all price records keyed by unit_id:date:rate_id (one row per rate plan)
    const pricesByKey = new Map<string, any>()

    let totalDates = 0
    let skippedNoUnit = 0
    const unmatchedTypeIds = new Set<string>()

    // Fetch prices for ALL rate plans × both date ranges — CONCURRENTLY.
    // With 13+ rate plans × 2 ranges, doing this sequentially (26+ awaited
    // round-trips to panel.hotres.pl) can blow past the Edge Function's
    // execution time limit for large properties, silently killing the
    // invocation before it ever reaches the later rate plans in the list —
    // they never even get logged, let alone synced. Firing every
    // (rate plan × range) request in parallel bounds the total wall time to
    // roughly the slowest single request instead of the sum of all of them.
    const fetchTasks = allRatePlans.flatMap(ratePlan =>
      dateRanges.map(range => ({ ratePlan, range }))
    )

    const fetchResults = await Promise.allSettled(
      fetchTasks.map(async ({ ratePlan, range }) => {
        console.log(`  📆 Fetching "${ratePlan.name}" ${range.label}: ${range.from} to ${range.till}`)
        const pricesUrl = `https://panel.hotres.pl/api_prices?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&rate_id=${ratePlan.external_id}&from=${range.from}&till=${range.till}`
        const rawResponse = await fetchFromHotres(pricesUrl)
        let pricesData = JSON.parse(rawResponse)
        if (!Array.isArray(pricesData)) pricesData = [pricesData]
        console.log(`  📥 "${ratePlan.name}" ${range.label}: ${pricesData.length} items`)
        return { ratePlan, range, pricesData }
      })
    )

    for (let i = 0; i < fetchResults.length; i++) {
      const result = fetchResults[i]
      const { ratePlan, range } = fetchTasks[i]

      if (result.status === 'rejected') {
        console.error(`  ❌ Failed "${ratePlan.name}" ${range.label}:`, result.reason?.message)
        continue
      }

      const { pricesData } = result.value

      // Log first date record to verify field names from Hotres
      if (pricesData.length > 0 && pricesData[0].dates?.length > 0) {
        console.log(`  🔬 Sample date record keys:`, Object.keys(pricesData[0].dates[0]))
        console.log(`  🔬 Sample date record:`, JSON.stringify(pricesData[0].dates[0]))
      }

      for (const item of pricesData) {
        if (!item || !item.type_id) continue

        const typeId = String(item.type_id).trim()
        const unit = unitMapByTypeId.get(typeId)
        if (!unit) {
          // Record is silently dropped because no unit matches this type_id.
          // Log once per type_id so we can detect external_type_id mismatches.
          skippedNoUnit += Array.isArray(item.dates) ? item.dates.length : 1
          if (!unmatchedTypeIds.has(typeId)) {
            unmatchedTypeIds.add(typeId)
            console.warn(`  ⚠️ No unit matched for type_id "${typeId}" — records dropped. Known type_ids: [${Array.from(unitMapByTypeId.keys()).join(', ')}]`)
          }
          continue
        }

        if (item.dates && Array.isArray(item.dates)) {
          for (const d of item.dates) {
            const dateStr = normalizeDate(d.date)
            const key = `${unit.id}:${dateStr}:${ratePlan.id}`
            if (!pricesByKey.has(key)) {
              pricesByKey.set(key, {
                unit_id: unit.id,
                rate_id: ratePlan.id,
                date: dateStr,
                price: parseFloatOrNull(d.price),
                min: parseIntOrNull(d.min),
                max: parseIntOrNull(d.max),
                cta: parseIntOrNull(d.cta),
                ctd: parseIntOrNull(d.ctd)
              })
              totalDates++
            }
          }
        }
      }
    }

    console.log(`  📊 Total: ${totalDates} unique price records across all rate plans`)
    if (skippedNoUnit > 0) {
      console.warn(`  ⚠️ Skipped ${skippedNoUnit} records (${unmatchedTypeIds.size} unmatched type_id(s): ${Array.from(unmatchedTypeIds).join(', ')})`)
    }

    const pricesToUpsert = Array.from(pricesByKey.values())
    console.log(`  📦 Collected ${pricesToUpsert.length} unique price records (unit+date combinations)`)

    // Show sample records with CTA/CTD/MIN
    const samplesWithRestrictions = pricesToUpsert.filter(p =>
      p.cta !== null || p.ctd !== null || p.min !== null
    ).slice(0, 3)

    if (samplesWithRestrictions.length > 0) {
      console.log(`  📊 Sample records with CTA/CTD/MIN:`, samplesWithRestrictions)
    } else {
      console.log(`  ⚠️ No records found with CTA/CTD/MIN values`)
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

    return { recordsCompared: pricesToUpsert.length, changesDetected: 0 }
  } catch (error: any) {
    console.error(`❌ Error syncing prices for ${property.name}:`, error.message)
    console.error(`❌ Stack trace:`, error.stack)
    console.error(`❌ Full error:`, JSON.stringify(error, null, 2))
    return { recordsCompared: 0, changesDetected: 0 }
  }
}

async function buildSyncResult(property: Property, supabaseClient: any, pricesOnly: boolean) {
  // Sync prices always; skip availability when prices_only flag is set
  const [availResult, pricesResult] = await Promise.allSettled([
    pricesOnly ? Promise.resolve({ recordsCompared: 0, changesDetected: 0 }) : syncPropertyAvailability(property, supabaseClient),
    syncPropertyPrices(property, supabaseClient)
  ])

  return {
    property: {
      id: property.id,
      name: property.name
    },
    availability: availResult.status === 'fulfilled' ? {
      success: true,
      recordsCompared: availResult.value.recordsCompared,
      changesDetected: availResult.value.changesDetected
    } : {
      success: false,
      error: (availResult as PromiseRejectedResult).reason?.message || 'Unknown error'
    },
    prices: pricesResult.status === 'fulfilled' ? {
      success: true,
      recordsCompared: pricesResult.value.recordsCompared,
      changesDetected: pricesResult.value.changesDetected
    } : {
      success: false,
      error: (pricesResult as PromiseRejectedResult).reason?.message || 'Unknown error'
    }
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body. property_id is optional — omitting it (as the
    // scheduled cron does) runs the sync for every property with a
    // hotres_id, one at a time is still too slow for many properties, so
    // they're run concurrently via Promise.allSettled.
    const body = await req.json().catch(() => ({}))
    const { property_id, prices_only } = body

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    if (property_id) {
      console.log(`🚀 Starting sync for property: ${property_id}`)

      const { data: property, error: propertyError } = await supabaseClient
        .from('properties')
        .select('id, name, hotres_id')
        .eq('id', property_id)
        .single()

      if (propertyError || !property) {
        console.error(`❌ Property not found: ${property_id}`)
        return new Response(
          JSON.stringify({ error: 'Property not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      if (!property.hotres_id) {
        console.error(`❌ Property ${property.name} has no hotres_id`)
        return new Response(
          JSON.stringify({ error: 'Property has no hotres_id configured' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      console.log(`📋 Property found: ${property.name} (hotres_id: ${property.hotres_id})`)

      const response = await buildSyncResult(property, supabaseClient, !!prices_only)

      console.log(`✅ Sync complete for ${property.name}`)
      console.log(`📊 Results:`, JSON.stringify(response, null, 2))

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // No property_id → scheduled full-portfolio run (the 10-minute cron calls
    // this with { "prices_only": true } so it doesn't duplicate the
    // separate 3-minute availability-only cron).
    console.log(`🚀 Starting sync for ALL properties (prices_only=${!!prices_only})`)

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

    const results = await Promise.allSettled(
      properties.map((property: Property) => buildSyncResult(property, supabaseClient, !!prices_only))
    )

    const propertyResults = results.map((result, i) =>
      result.status === 'fulfilled'
        ? result.value
        : { property: { id: properties[i].id, name: properties[i].name }, error: result.reason?.message || 'Unknown error' }
    )

    console.log(`✅ Sync complete for ${properties.length} properties`)

    return new Response(
      JSON.stringify({ count: properties.length, results: propertyResults }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('❌ Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

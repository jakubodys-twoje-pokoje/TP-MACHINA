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
      .select('id, external_type_id')
      .eq('property_id', property.id)
      .not('external_type_id', 'is', null)

    if (!units || units.length === 0) {
      console.log(`  ⚠️ No units with external_type_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  📊 Found ${units.length} units`)

    // Get ALL rate plans for this property
    const { data: allRatePlans, error: ratePlansError } = await supabaseClient
      .from('rate_plans')
      .select('id, external_id, name')
      .eq('property_id', property.id)
      .not('external_id', 'is', null)

    if (!allRatePlans || allRatePlans.length === 0) {
      console.log(`  ⚠️ No rate plans with external_id for ${property.name}`)
      return { recordsCompared: 0, changesDetected: 0 }
    }

    console.log(`  📋 Rate plans for ${property.name}: ${allRatePlans.length} total — syncing ALL`)
    console.log(`  📋 Plans:`, allRatePlans.map(rp => `"${rp.name}" (ext_id: ${rp.external_id})`))

    // Fetch prices from Hotres - split into two ranges (180 day API limit)
    const dateRanges = [
      { from: '2026-01-20', till: '2026-07-18', label: 'first half' },
      { from: '2026-07-19', till: '2026-12-31', label: 'second half' }
    ]

    // Create mapping of type_id to unit for lookup
    const unitMapByTypeId = new Map<string, any>()
    units.forEach(u => {
      if (u.external_type_id) {
        unitMapByTypeId.set(String(u.external_type_id), u)
      }
    })

    // Collect all price records keyed by unit_id:date:rate_id (one row per rate plan)
    const pricesByKey = new Map<string, any>()

    let totalDates = 0

    // Fetch prices for ALL rate plans × both date ranges
    for (const ratePlan of allRatePlans) {
      for (const range of dateRanges) {
        console.log(`  📆 Fetching "${ratePlan.name}" ${range.label}: ${range.from} to ${range.till}`)

        try {
          const pricesUrl = `https://panel.hotres.pl/api_prices?user=${encodeURIComponent(apiUser)}&password=${encodeURIComponent(apiPass)}&oid=${oid}&rate_id=${ratePlan.external_id}&from=${range.from}&till=${range.till}`

          const rawResponse = await fetchFromHotres(pricesUrl)
          let pricesData = JSON.parse(rawResponse)

          if (!Array.isArray(pricesData)) {
            pricesData = [pricesData]
          }

          console.log(`  📥 "${ratePlan.name}" ${range.label}: ${pricesData.length} items`)

          for (const item of pricesData) {
            if (!item || !item.type_id) continue

            const typeId = String(item.type_id)
            const unit = unitMapByTypeId.get(typeId)
            if (!unit) continue

            if (item.dates && Array.isArray(item.dates)) {
              for (const d of item.dates) {
                const key = `${unit.id}:${d.date}:${ratePlan.id}`
                if (!pricesByKey.has(key)) {
                  pricesByKey.set(key, {
                    unit_id: unit.id,
                    rate_id: ratePlan.id,
                    date: d.date,
                    price: d.price ? parseFloat(d.price) : null,
                    min: d.min ? parseInt(d.min) : null,
                    max: d.max ? parseInt(d.max) : null,
                    cta: d.cta !== null && d.cta !== undefined ? parseInt(d.cta) : null,
                    ctd: d.ctd !== null && d.ctd !== undefined ? parseInt(d.ctd) : null
                  })
                  totalDates++
                }
              }
            }
          }
        } catch (error: any) {
          console.error(`  ❌ Failed "${ratePlan.name}" ${range.label}:`, error.message)
        }
      }
    }

    console.log(`  📊 Total: ${totalDates} unique price records across all rate plans`)

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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request body
    const { property_id, prices_only } = await req.json()

    if (!property_id) {
      return new Response(
        JSON.stringify({ error: 'property_id is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    console.log(`🚀 Starting sync for property: ${property_id}`)

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    // Fetch the property
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

    // Sync prices always; skip availability when prices_only flag is set
    const [availResult, pricesResult] = await Promise.allSettled([
      prices_only ? Promise.resolve({ recordsCompared: 0, changesDetected: 0 }) : syncPropertyAvailability(property, supabaseClient),
      syncPropertyPrices(property, supabaseClient)
    ])

    const response = {
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
        error: availResult.reason?.message || 'Unknown error'
      },
      prices: pricesResult.status === 'fulfilled' ? {
        success: true,
        recordsCompared: pricesResult.value.recordsCompared,
        changesDetected: pricesResult.value.changesDetected
      } : {
        success: false,
        error: pricesResult.reason?.message || 'Unknown error'
      }
    }

    console.log(`✅ Sync complete for ${property.name}`)
    console.log(`📊 Results:`, JSON.stringify(response, null, 2))

    return new Response(
      JSON.stringify(response),
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

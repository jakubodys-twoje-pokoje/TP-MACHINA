// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Retry logic with exponential backoff
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1}/${maxRetries} for: ${url}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Supabase-Edge-Function',
          'Accept': 'application/xml, text/xml, application/json, */*',
        },
        signal: controller.signal
      })

      clearTimeout(timeoutId)

    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP error! status: ${response.status}, body: ${body.slice(0, 500)}`)
      }

      return response
    } catch (error: any) {
      lastError = error
      console.error(`Attempt ${attempt + 1} failed:`, error.message)

      // Don't retry on 4xx errors (client errors)
      if (error.message.includes('status: 4')) {
        throw error
      }

      // If not the last attempt, wait before retrying
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
        console.log(`Waiting ${delay}ms before retry...`)
        await sleep(delay)
      }
    }
  }

  throw lastError || new Error('Failed after retries')
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL parameter is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // Add cache busting
    const targetUrl = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`

    console.log(`Proxying request to: ${targetUrl}`)

    // Fetch with retry logic
    const response = await fetchWithRetry(targetUrl)

    const text = await response.text()

    console.log(`✓ Successfully fetched ${text.length} bytes`)

    return new Response(
      JSON.stringify({ data: text }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('Proxy error:', error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const HOTRES_API_USER = 'admin@twojepokoje.com.pl';
const HOTRES_API_PASSWORD = 'Admin123@@';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { property_id, payload } = await req.json();

    if (!property_id || !payload || !Array.isArray(payload)) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: property_id, payload (array)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get property to fetch oid
    const { data: property, error: propError } = await supabaseClient
      .from('properties')
      .select('hotres_id')
      .eq('id', property_id)
      .single();

    if (propError || !property?.hotres_id) {
      return new Response(
        JSON.stringify({ error: 'Property not found or missing hotres_id' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const oid = property.hotres_id;

    // Convert type_id to number, keep rate_id as is (can be string or number)
    const normalizedPayload = payload.map((item: any) => ({
      ...item,
      type_id: parseInt(item.type_id),
      rate_id: item.rate_id // Keep as string - Hotres accepts both
    }));

    // Build URL with auth parameters only
    const url = `https://panel.hotres.pl/api_updateprices?user=${HOTRES_API_USER}&password=${HOTRES_API_PASSWORD}&oid=${oid}`;

    console.log(`📤 Sending price update to Hotres with payload:`, JSON.stringify(normalizedPayload, null, 2));

    // Build form data with payload as JSON string (Hotres expects this format)
    const formData = new URLSearchParams();
    formData.append('payload', JSON.stringify(normalizedPayload));

    console.log(`📤 Form data payload value:`, formData.get('payload'));

    // Call Hotres API with POST
    const hotresResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });
    const responseText = await hotresResponse.text();

    console.log(`📥 Hotres response: ${responseText}`);

    if (!hotresResponse.ok) {
      throw new Error(`Hotres API error: ${hotresResponse.status} - ${responseText}`);
    }

    // Parse response
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // If not JSON, treat as success if status is ok
      responseData = { message: responseText };
    }

    return new Response(
      JSON.stringify({
        success: true,
        hotres_response: responseData
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('❌ Error in update-hotres-prices:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

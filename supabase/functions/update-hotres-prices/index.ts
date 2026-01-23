import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const HOTRES_API_USER = Deno.env.get('HOTRES_API_USER') || '';
const HOTRES_API_PASSWORD = Deno.env.get('HOTRES_API_PASSWORD') || '';

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { property_id, type_id, from, till, cta, ctd, min } = await req.json();

    if (!property_id || !type_id || !from || !till) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: property_id, type_id, from, till' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get property to fetch oid
    const { data: property, error: propError } = await supabaseClient
      .from('properties')
      .select('external_id')
      .eq('id', property_id)
      .single();

    if (propError || !property?.external_id) {
      return new Response(
        JSON.stringify({ error: 'Property not found or missing external_id' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const oid = property.external_id;

    // Build api_updateprices URL with parameters
    let url = `https://panel.hotres.pl/api_updateprices?user=${HOTRES_API_USER}&password=${HOTRES_API_PASSWORD}&oid=${oid}&type_id=${type_id}&from=${from}&till=${till}`;

    if (cta !== undefined && cta !== null) {
      url += `&cta=${cta}`;
    }
    if (ctd !== undefined && ctd !== null) {
      url += `&ctd=${ctd}`;
    }
    if (min !== undefined && min !== null) {
      url += `&min=${min}`;
    }

    console.log(`📤 Sending price update to Hotres: ${url.replace(HOTRES_API_PASSWORD, '***')}`);

    // Call Hotres API
    const hotresResponse = await fetch(url);
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
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('❌ Error in update-hotres-prices:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
});

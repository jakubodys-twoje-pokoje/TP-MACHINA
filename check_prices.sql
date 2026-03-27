-- Check prices table structure and data
-- Run this in Supabase SQL Editor

-- 1. Total records in prices table
SELECT
  COUNT(*) as total_records,
  COUNT(DISTINCT unit_id) as unique_units,
  COUNT(DISTINCT rate_id) as unique_rate_plans,
  MIN(date) as earliest_date,
  MAX(date) as latest_date
FROM prices;

-- 2. Records with CTA/CTD/MIN values
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN cta = 1 THEN 1 END) as cta_enabled,
  COUNT(CASE WHEN ctd = 1 THEN 1 END) as ctd_enabled,
  COUNT(CASE WHEN min IS NOT NULL THEN 1 END) as has_min
FROM prices;

-- 3. Check data for today (2026-01-23)
SELECT
  p.date,
  u.name as unit_name,
  prop.name as property_name,
  rp.name as rate_plan_name,
  p.cta,
  p.ctd,
  p.min,
  p.price
FROM prices p
JOIN units u ON u.id = p.unit_id
JOIN properties prop ON prop.id = u.property_id
JOIN rate_plans rp ON rp.id = p.rate_id
WHERE p.date = '2026-01-23'
ORDER BY prop.name, u.name;

-- 4. Check which properties have prices data
SELECT
  prop.name as property_name,
  prop.id as property_id,
  COUNT(DISTINCT p.unit_id) as units_with_prices,
  COUNT(*) as total_price_records
FROM properties prop
LEFT JOIN units u ON u.property_id = prop.id
LEFT JOIN prices p ON p.unit_id = u.id
GROUP BY prop.id, prop.name
ORDER BY total_price_records DESC;

-- 5. Check which properties are missing rate_plans
SELECT
  prop.name as property_name,
  COUNT(u.id) as total_units,
  COUNT(rp.id) as rate_plans_count
FROM properties prop
LEFT JOIN units u ON u.property_id = prop.id
LEFT JOIN rate_plans rp ON rp.property_id = prop.id
GROUP BY prop.id, prop.name
ORDER BY rate_plans_count;

-- 6. Sample prices data with all fields
SELECT
  p.date,
  u.name as unit_name,
  p.cta,
  p.ctd,
  p.min,
  p.max,
  p.price,
  p.synced_at
FROM prices p
JOIN units u ON u.id = p.unit_id
WHERE p.date BETWEEN '2026-01-23' AND '2026-01-25'
LIMIT 20;

-- Diagnostyka: Zew Morza - dlaczego MIN tylko do 20 sierpnia?

-- 1. Znajdź property_id dla "Zew Morza"
SELECT id, name
FROM properties
WHERE name ILIKE '%zew%morza%' OR name ILIKE '%morza%';

-- 2. Znajdź units dla tego obiektu (wstaw property_id z wyniku powyżej)
SELECT id, name, external_type_id, sync_enabled
FROM units
WHERE property_id = 'TUTAJ_WSTAW_PROPERTY_ID_Z_KROKU_1'
ORDER BY name;

-- 3. Sprawdź zakres dat z cenami dla tych units (wstaw unit_ids z kroku 2)
SELECT
  u.name as unit_name,
  MIN(p.date) as first_date,
  MAX(p.date) as last_date,
  COUNT(*) as total_records,
  COUNT(CASE WHEN p.min IS NOT NULL AND p.min > 0 THEN 1 END) as records_with_min
FROM prices p
JOIN units u ON u.id = p.unit_id
WHERE u.property_id = 'TUTAJ_WSTAW_PROPERTY_ID_Z_KROKU_1'
GROUP BY u.name
ORDER BY u.name;

-- 4. Sprawdź szczegółowo MIN values dla sierpnia-września (wstaw property_id)
SELECT
  u.name as unit_name,
  p.date,
  p.min,
  p.cta,
  p.ctd,
  p.rate_id
FROM prices p
JOIN units u ON u.id = p.unit_id
WHERE u.property_id = 'TUTAJ_WSTAW_PROPERTY_ID_Z_KROKU_1'
  AND p.date >= '2026-08-15'
  AND p.date <= '2026-09-15'
ORDER BY u.name, p.date;

-- 5. Sprawdź logi synchronizacji dla tego obiektu
SELECT
  created_at,
  status,
  error,
  records_compared,
  changes_detected
FROM sync_logs
WHERE property_id = 'TUTAJ_WSTAW_PROPERTY_ID_Z_KROKU_1'
ORDER BY created_at DESC
LIMIT 10;

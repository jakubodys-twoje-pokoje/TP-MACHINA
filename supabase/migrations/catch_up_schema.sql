-- ============================================================================
-- ZBIORCZA MIGRACJA "DOGONIENIA" SCHEMATU
-- ============================================================================
-- Dodaje wszystkie kolumny, których oczekuje aktualny kod (frontend + edge
-- functions), a które mogły zostać pominięte przy wcześniejszych wdrożeniach.
-- W pełni idempotentna: każda instrukcja to IF NOT EXISTS albo bezpieczny
-- no-op, więc można ją uruchamiać wielokrotnie — także po ewentualnym
-- przywróceniu bazy z backupu.
--
-- Kolejność: najpierw kolumny, na końcu porządki (zwolnienie zawieszonych
-- blokad synchronizacji) i zapytanie weryfikacyjne.

-- === properties ==============================================================
ALTER TABLE properties ADD COLUMN IF NOT EXISTS availability_sync_in_progress BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS availability_last_synced_at TIMESTAMP WITH TIME ZONE;
-- znacznik startu blokady sync — wymagany przez sync-all-availability (stale-lock takeover)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS availability_sync_started_at TIMESTAMP WITH TIME ZONE;
-- opcjonalny późniejszy start zakresu synchronizacji per obiekt
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sync_from_date DATE;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS selected_rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL;
-- cele push dla silnika ochrony luk (gap autofill cron)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS push_rate_plan_ids UUID[] DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS workflow_assigned_to TEXT DEFAULT NULL;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS workflow_position INTEGER;

-- === units ===================================================================
ALTER TABLE units ADD COLUMN IF NOT EXISTS selected_rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL;
-- ręczna kolejność kwater (kalendarz / matryca cenników / cenniki / kwatery)
ALTER TABLE units ADD COLUMN IF NOT EXISTS display_order INTEGER;
ALTER TABLE units ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT true;

-- === prices ==================================================================
-- cta_synced/ctd_synced historycznie dodane ad-hoc bez pliku migracji —
-- kalendarz ich używa (kolory statusu synchronizacji z Hotresem)
ALTER TABLE prices ADD COLUMN IF NOT EXISTS cta_synced BOOLEAN;
ALTER TABLE prices ADD COLUMN IF NOT EXISTS ctd_synced BOOLEAN;
ALTER TABLE prices ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- === notifications ===========================================================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_by_email TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

-- === sync_logs ===============================================================
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS records_compared INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_with_changes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notifications_created INTEGER DEFAULT 0;

-- === workflow_entries ========================================================
ALTER TABLE workflow_entries ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL;

-- === commission_settings =====================================================
ALTER TABLE commission_settings ADD COLUMN IF NOT EXISTS count_from DATE;

-- === porządki ================================================================
-- Zwolnij ewentualne zawieszone blokady availability (skutek braku kolumny
-- availability_sync_started_at przez ostatnie tygodnie).
UPDATE properties
SET availability_sync_in_progress = false
WHERE availability_sync_in_progress = true;

-- === weryfikacja =============================================================
-- Powinno zwrócić 20 wierszy — każda oczekiwana kolumna z dopiskiem OK.
SELECT w.table_name, w.column_name,
       CASE WHEN c.column_name IS NOT NULL THEN 'OK' ELSE 'BRAK!' END AS status
FROM (VALUES
  ('properties','availability_sync_in_progress'),
  ('properties','availability_last_synced_at'),
  ('properties','availability_sync_started_at'),
  ('properties','sync_from_date'),
  ('properties','selected_rate_plan_id'),
  ('properties','push_rate_plan_ids'),
  ('properties','workflow_assigned_to'),
  ('properties','workflow_position'),
  ('units','selected_rate_plan_id'),
  ('units','display_order'),
  ('units','sync_enabled'),
  ('prices','cta_synced'),
  ('prices','ctd_synced'),
  ('prices','synced_at'),
  ('notifications','read_by_email'),
  ('notifications','read_at'),
  ('sync_logs','records_compared'),
  ('sync_logs','units_with_changes'),
  ('sync_logs','notifications_created'),
  ('workflow_entries','assigned_to')
) AS w(table_name, column_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = w.table_name
 AND c.column_name = w.column_name
ORDER BY w.table_name, w.column_name;

-- Gap Protection Engine: layered policy configuration.
-- Scope columns that are NULL act as wildcards; the most-specific matching row
-- wins (see engine/resolveConfig.ts). All parameter columns are NOT NULL.
CREATE TABLE IF NOT EXISTS gap_engine_config (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- SCOPE (NULL = "any"):
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  unit_id       UUID REFERENCES units(id) ON DELETE CASCADE,
  unit_type     TEXT,
  season        TEXT,
  channel       TEXT,
  date_from     DATE,
  date_to       DATE,
  -- PARAMETERS:
  standard_min_los          INTEGER NOT NULL DEFAULT 2,
  min_acceptable_gap        INTEGER NOT NULL DEFAULT 3,
  emergency_acceptable_gap  INTEGER NOT NULL DEFAULT 2,
  max_los                   INTEGER,                          -- NULL = no cap
  last_minute_lead_days     INTEGER NOT NULL DEFAULT 7,
  emergency_mode            BOOLEAN NOT NULL DEFAULT false,
  allow_shorten_min_los     BOOLEAN NOT NULL DEFAULT true,
  horizon_days              INTEGER NOT NULL DEFAULT 365,
  priority                  INTEGER NOT NULL DEFAULT 0,        -- tie-break
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gap_cfg_property ON gap_engine_config(property_id);
CREATE INDEX IF NOT EXISTS idx_gap_cfg_unit ON gap_engine_config(unit_id);

ALTER TABLE gap_engine_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view gap_engine_config"
  ON gap_engine_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage gap_engine_config"
  ON gap_engine_config FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can read gap_engine_config"
  ON gap_engine_config FOR SELECT
  TO service_role
  USING (true);

-- Seed a sensible global default (matches engine DEFAULT_CONFIG).
INSERT INTO gap_engine_config (standard_min_los, min_acceptable_gap, emergency_acceptable_gap, last_minute_lead_days, horizon_days)
VALUES (2, 3, 2, 7, 365)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE gap_engine_config IS 'Layered config for the Gap Protection Engine; most-specific matching row wins.';

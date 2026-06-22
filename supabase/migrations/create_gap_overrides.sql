-- Gap Protection Engine: persistent operator overrides.
-- Stored separately so an override SURVIVES recompute (the engine applies these
-- last, marking the day source='manual'). Override may loosen OR tighten.
CREATE TABLE IF NOT EXISTS gap_overrides (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id        UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  date_from      DATE NOT NULL,
  date_to        DATE NOT NULL,
  cta            SMALLINT CHECK (cta IN (0, 1)),       -- NULL = leave auto value
  ctd            SMALLINT CHECK (ctd IN (0, 1)),       -- NULL = leave auto value
  min_los        INTEGER,                              -- NULL = leave auto value
  reason         TEXT,
  operator_email TEXT,
  expires_at     TIMESTAMPTZ,                          -- NULL = until manually removed
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gap_ovr_unit ON gap_overrides(unit_id, date_from, date_to);

ALTER TABLE gap_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view gap_overrides"
  ON gap_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can manage gap_overrides"
  ON gap_overrides FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can read gap_overrides"
  ON gap_overrides FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE gap_overrides IS 'Operator overrides for the Gap Protection Engine; applied after auto computation, survive recompute.';

-- Gap Protection Engine: per-day output of the deterministic engine.
-- Kept SEPARATE from `prices` (which mirrors Hotres on pull) so engine output +
-- audit fields never collide with the pull and share the same conflict key.
CREATE TABLE IF NOT EXISTS gap_restrictions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  rate_id     UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  cta         SMALLINT CHECK (cta IN (0, 1)),
  ctd         SMALLINT CHECK (ctd IN (0, 1)),
  min_los     INTEGER,
  max_los     INTEGER,
  gap_id      TEXT,                                   -- stable gap id, e.g. "unit:gap_start"
  reason      TEXT,                                   -- 'cta_protect_left_gap', 'arrival_open', ...
  source      TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  confidence  NUMERIC(3, 2) NOT NULL DEFAULT 1.0,     -- 0..1
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (unit_id, rate_id, date)                     -- same onConflict as prices
);

CREATE INDEX IF NOT EXISTS idx_gap_restr_unit_date ON gap_restrictions(unit_id, date);
CREATE INDEX IF NOT EXISTS idx_gap_restr_rate_date ON gap_restrictions(rate_id, date);
CREATE INDEX IF NOT EXISTS idx_gap_restr_gap ON gap_restrictions(gap_id);

ALTER TABLE gap_restrictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view gap_restrictions"
  ON gap_restrictions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update gap_restrictions"
  ON gap_restrictions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can write gap_restrictions"
  ON gap_restrictions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE gap_restrictions IS 'Per-day CTA/CTD/MIN/MAX produced by the Gap Protection Engine (deterministic).';
COMMENT ON COLUMN gap_restrictions.source IS 'auto = engine output, manual = operator override applied';
COMMENT ON COLUMN gap_restrictions.confidence IS '0..1: 1 deterministic, 0.6 emergency/last-minute, 0.3 unsellable-needs-override';

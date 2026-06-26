-- Commission calculator: per-property rate + saved historical reports.
CREATE TABLE IF NOT EXISTS commission_settings (
  property_id  UUID PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  rate_percent NUMERIC(6, 3) NOT NULL DEFAULT 0,   -- e.g. 15.000 = 15%
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commission_reports (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label             TEXT,
  count_from        DATE,                          -- "licz prowizję od" (add_date cutoff)
  rate_percent      NUMERIC(6, 3) NOT NULL,        -- snapshot of the rate used
  total_price       NUMERIC(14, 2) NOT NULL DEFAULT 0,
  total_commission  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  reservation_count INTEGER NOT NULL DEFAULT 0,
  rows              JSONB NOT NULL DEFAULT '[]',    -- the final report rows (snapshot)
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_commission_reports_prop ON commission_reports(property_id, created_at DESC);

ALTER TABLE commission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage commission_settings" ON commission_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Users manage commission_reports" ON commission_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE commission_settings IS 'Per-property commission rate (% of price), remembered.';
COMMENT ON TABLE commission_reports IS 'Saved commission report snapshots (history) per property.';

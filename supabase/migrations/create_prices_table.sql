-- Create prices table to store pricing and restrictions from Hotres API
CREATE TABLE IF NOT EXISTS prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  rate_id UUID NOT NULL REFERENCES rate_plans(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  price DECIMAL(10, 2),
  min INTEGER,
  max INTEGER,
  cta SMALLINT CHECK (cta IN (0, 1)),
  ctd SMALLINT CHECK (ctd IN (0, 1)),
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(unit_id, rate_id, date)
);

-- Indexes for faster queries
CREATE INDEX idx_prices_unit_date ON prices(unit_id, date);
CREATE INDEX idx_prices_rate_date ON prices(rate_id, date);
CREATE INDEX idx_prices_date ON prices(date);

-- RLS policies
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view prices"
  ON prices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update prices"
  ON prices FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert prices"
  ON prices FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE prices IS 'Stores pricing and restrictions (CTA/CTD/MIN/MAX) synced from Hotres API';
COMMENT ON COLUMN prices.price IS 'Base price from Hotres';
COMMENT ON COLUMN prices.min IS 'Minimum length of stay (nights)';
COMMENT ON COLUMN prices.max IS 'Maximum length of stay (nights)';
COMMENT ON COLUMN prices.cta IS 'Closed to arrival (0=open, 1=closed)';
COMMENT ON COLUMN prices.ctd IS 'Closed to departure (0=open, 1=closed)';

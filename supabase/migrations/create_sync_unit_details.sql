-- Create sync_unit_details table to track per-unit synchronization metrics
CREATE TABLE IF NOT EXISTS sync_unit_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sync_history_id UUID NOT NULL REFERENCES sync_history(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  unit_name TEXT NOT NULL,
  days_fetched INTEGER NOT NULL DEFAULT 0,
  records_compared INTEGER NOT NULL DEFAULT 0,
  changes_detected INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries by sync_history and unit
CREATE INDEX idx_sync_unit_details_sync_history ON sync_unit_details(sync_history_id);
CREATE INDEX idx_sync_unit_details_unit ON sync_unit_details(unit_id, synced_at DESC);
CREATE INDEX idx_sync_unit_details_property ON sync_unit_details(property_id, synced_at DESC);

-- RLS policies
ALTER TABLE sync_unit_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync unit details"
  ON sync_unit_details FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE sync_unit_details IS 'Tracks detailed per-unit synchronization metrics';
COMMENT ON COLUMN sync_unit_details.days_fetched IS 'Number of days fetched from API for this unit';
COMMENT ON COLUMN sync_unit_details.records_compared IS 'Number of availability records compared for this unit';
COMMENT ON COLUMN sync_unit_details.changes_detected IS 'Number of changes detected for this unit';

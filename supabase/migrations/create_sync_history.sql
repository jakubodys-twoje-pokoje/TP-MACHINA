-- Create sync_history table to track synchronization metrics
CREATE TABLE IF NOT EXISTS sync_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  property_name TEXT NOT NULL,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  records_compared INTEGER NOT NULL DEFAULT 0,
  changes_detected INTEGER NOT NULL DEFAULT 0,
  notifications_sent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success', -- 'success' or 'error'
  error_message TEXT,
  CONSTRAINT sync_history_status_check CHECK (status IN ('success', 'error'))
);

-- Index for faster queries by property and date
CREATE INDEX idx_sync_history_property_date ON sync_history(property_id, synced_at DESC);

-- RLS policies
ALTER TABLE sync_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sync history"
  ON sync_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can delete sync history"
  ON sync_history FOR DELETE
  TO authenticated
  USING (true);

COMMENT ON TABLE sync_history IS 'Tracks synchronization history and metrics for each property';
COMMENT ON COLUMN sync_history.records_compared IS 'Number of availability records compared from API';
COMMENT ON COLUMN sync_history.changes_detected IS 'Number of changes detected (available/blocked)';
COMMENT ON COLUMN sync_history.notifications_sent IS 'Number of push notifications sent';

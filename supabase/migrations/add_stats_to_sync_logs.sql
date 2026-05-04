-- Add statistics columns to sync_logs table
ALTER TABLE sync_logs
  ADD COLUMN IF NOT EXISTS records_compared INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_with_changes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notifications_created INTEGER DEFAULT 0;

COMMENT ON COLUMN sync_logs.records_compared IS 'Total number of availability records compared (snapshot size)';
COMMENT ON COLUMN sync_logs.units_with_changes IS 'Number of units that had availability changes detected';
COMMENT ON COLUMN sync_logs.notifications_created IS 'Number of notifications created from detected changes';

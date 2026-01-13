-- Create sync_logs table for tracking availability synchronization
CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  successes JSONB DEFAULT '[]'::jsonb,
  errors JSONB DEFAULT '[]'::jsonb
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS sync_logs_created_at_idx ON sync_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow authenticated users to read all logs
CREATE POLICY "Allow authenticated users to read sync logs"
  ON sync_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Allow service role to insert logs (for Edge Function)
CREATE POLICY "Allow service role to insert sync logs"
  ON sync_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Allow authenticated users to delete old logs
CREATE POLICY "Allow authenticated users to delete sync logs"
  ON sync_logs
  FOR DELETE
  TO authenticated
  USING (true);

-- Comment
COMMENT ON TABLE sync_logs IS 'Stores logs from automatic availability synchronization with Hotres API';

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE sync_logs;

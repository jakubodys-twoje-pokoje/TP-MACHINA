-- Create notifications table for tracking availability changes
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  property_name TEXT NOT NULL,
  unit_name TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('available', 'blocked')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_property_id_idx ON notifications(property_id);
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_is_read_idx ON notifications(is_read);

-- Enable Row Level Security
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own notifications
CREATE POLICY "Users can read their own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can update their own notifications (mark as read)
CREATE POLICY "Users can update their own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own notifications
CREATE POLICY "Users can delete their own notifications"
  ON notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Service role can insert notifications (for Edge Function)
CREATE POLICY "Service role can insert notifications"
  ON notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Comment
COMMENT ON TABLE notifications IS 'Stores notifications about availability changes detected during synchronization';

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

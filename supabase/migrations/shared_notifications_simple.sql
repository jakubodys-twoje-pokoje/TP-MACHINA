-- Migration: Convert notifications to shared system (simple version)
-- All users see all notifications, "first to mark, marks for everyone"

-- Step 1: Remove user_id from notifications (make them shared)
ALTER TABLE notifications DROP COLUMN IF EXISTS user_id;

-- Step 2: Update RLS policies for notifications
-- Drop old user-specific policies
DROP POLICY IF EXISTS "Users can read their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;

-- Create new shared policies
CREATE POLICY "All authenticated users can read all notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can update notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "All authenticated users can delete notifications"
  ON notifications
  FOR DELETE
  TO authenticated
  USING (true);

-- Service role can still insert (for Edge Function)
-- (This policy should already exist, but recreate to be safe)
DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;
CREATE POLICY "Service role can insert notifications"
  ON notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE notifications IS 'Shared notifications - all users see the same notifications, first to mark as read marks for everyone';

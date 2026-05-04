-- Migration: Convert notifications to shared system (fixed order)
-- Step 1: Drop ALL old policies first (they depend on user_id)
DROP POLICY IF EXISTS "Allow own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can read their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON notifications;
DROP POLICY IF EXISTS "Service role can insert notifications" ON notifications;

-- Step 2: Now we can safely drop user_id column
ALTER TABLE notifications DROP COLUMN IF EXISTS user_id;

-- Step 3: Create new shared policies
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

CREATE POLICY "Service role can insert notifications"
  ON notifications
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE notifications IS 'Shared notifications - all users see the same notifications, first to mark as read marks for everyone';

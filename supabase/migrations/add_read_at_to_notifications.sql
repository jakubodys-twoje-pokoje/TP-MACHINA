-- Add read_at column to track when notification was marked as read
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN notifications.read_at IS 'Timestamp when the notification was marked as read';

-- Migration: Add read_by_email to notifications table
-- This will track which user marked the notification as read

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_by_email TEXT;

COMMENT ON COLUMN notifications.read_by_email IS 'Email of the user who marked this notification as read';

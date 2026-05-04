-- Migration: Fix duplicate notifications
-- Add unique constraint to prevent duplicate notifications for the same change

-- Step 1: Delete duplicate notifications (keep only the most recent one for each unique change)
DELETE FROM notifications a
USING notifications b
WHERE a.id < b.id
  AND a.property_id = b.property_id
  AND a.unit_id = b.unit_id
  AND a.change_type = b.change_type
  AND a.start_date = b.start_date
  AND a.end_date = b.end_date;

-- Step 2: Add unique constraint to prevent future duplicates
-- This ensures only one notification per property+unit+change_type+date_range
CREATE UNIQUE INDEX IF NOT EXISTS notifications_unique_change
  ON notifications(property_id, unit_id, change_type, start_date, end_date);

COMMENT ON INDEX notifications_unique_change IS 'Prevents duplicate notifications for the same availability change';

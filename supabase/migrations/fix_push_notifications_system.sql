-- Migration: Fix push notifications system
-- 1. Clean up duplicate subscriptions
-- 2. Add unique constraint to prevent future duplicates

-- Step 1: Delete all existing push subscriptions (they're duplicates anyway)
-- Users will need to re-enable notifications (one time only)
TRUNCATE TABLE push_subscriptions;

-- Step 2: Ensure proper structure
-- Add endpoint column for easier querying if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='push_subscriptions' AND column_name='endpoint'
  ) THEN
    ALTER TABLE push_subscriptions
      ADD COLUMN endpoint TEXT
      GENERATED ALWAYS AS ((subscription->>'endpoint')::TEXT) STORED;
  END IF;
END $$;

-- Step 3: Create unique index on user_id + endpoint to prevent duplicates
DROP INDEX IF EXISTS push_subscriptions_user_endpoint_unique;
CREATE UNIQUE INDEX push_subscriptions_user_endpoint_unique
  ON push_subscriptions(user_id, endpoint);

COMMENT ON TABLE push_subscriptions IS 'Stores browser push notification subscriptions. Unique per user + browser.';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Extracted from subscription JSON for uniqueness constraint';

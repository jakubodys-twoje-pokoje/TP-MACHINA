-- Per-property override for the sync start date. The sync functions default
-- to 2026-01-20 for every property, but a newly-opened property may not have
-- any Hotres data that early — requesting a range starting before a rate
-- plan/property existed can trip confusing errors from the Hotres API
-- instead of just returning an empty result. Let each property say "don't
-- bother syncing anything before this date".
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS sync_from_date DATE;

COMMENT ON COLUMN properties.sync_from_date IS
  'Overrides the global sync start date (2026-01-20) for properties that only started operating later — NULL means use the default.';

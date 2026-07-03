-- Stale-lock protection for the per-property availability sync guard.
--
-- sync-all-availability skips a property while availability_sync_in_progress
-- is true, but nothing ever cleared the flag if the run that set it died
-- (edge function killed mid-run, browser tab closed during a manual sync).
-- A stuck flag silently excluded the property from every subsequent run,
-- forever (observed in production: OW Champion, Zew Morza, Zielony Zakątek,
-- Arkadia Holiday, Willa Alexandria, Idalia).
--
-- The fix records WHEN the lock was taken, so the sync can treat a lock older
-- than a few minutes as abandoned and take it over (an honest sync finishes
-- well under the edge function's execution limit, far below that threshold).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS availability_sync_started_at TIMESTAMP WITH TIME ZONE;

-- One-time cleanup: release locks stuck from before this change (they have no
-- start timestamp, so the new stale-lock override would clear them anyway on
-- the next run — this just makes recovery immediate).
UPDATE properties
SET availability_sync_in_progress = false
WHERE availability_sync_in_progress = true;

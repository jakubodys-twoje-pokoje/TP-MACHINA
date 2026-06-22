-- Enable Postgres realtime for `notifications` so the calendar can react instantly
-- to new notifications (auto-suggest gap protection on arrival, in 'suggest' mode).
-- Safe to run repeatedly.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already in the publication
  WHEN undefined_object THEN NULL;  -- publication missing (older project) — configure in Dashboard → Database → Replication
END $$;

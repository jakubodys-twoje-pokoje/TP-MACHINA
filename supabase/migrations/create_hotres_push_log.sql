-- Server-side push rate-limit log, shared by manual pushes and gap autofill.
-- The limit (10 pushes / hour / property) is enforced by counting rows in the
-- last hour. Both the user push (UI) and the autofill cron INSERT a row here so
-- they count against the SAME limit (see docs §autofill).
CREATE TABLE IF NOT EXISTS hotres_push_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'autofill')),
  records     INTEGER,
  pushed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hotres_push_log_prop_time ON hotres_push_log(property_id, pushed_at DESC);

ALTER TABLE hotres_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view hotres_push_log"
  ON hotres_push_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert hotres_push_log"
  ON hotres_push_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role manages hotres_push_log"
  ON hotres_push_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE hotres_push_log IS 'One row per Hotres push (manual or autofill); used to enforce the shared 10/hour/property limit.';

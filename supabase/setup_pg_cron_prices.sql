-- Schedule sync-single-property to run every 10 minutes for ALL properties
-- (prices only — selected rate plans per unit — availability stays on the
-- separate 3-minute sync-all-availability-job in setup_pg_cron.sql).
--
-- Calling sync-single-property with no property_id in the body makes it loop
-- over every property with a hotres_id instead of just one.
SELECT cron.schedule(
  'sync-all-prices-job',  -- Job name
  '*/10 * * * *',         -- Cron expression: every 10 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-single-property',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{"prices_only": true}'::jsonb
    ) AS request_id;
  $$
);

-- Requires the same app.settings.service_role_key setting used by
-- sync-all-availability-job — see setup_pg_cron.sql if that hasn't been set.

-- To verify the job was created:
-- SELECT * FROM cron.job;

-- To see job run history:
-- SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'sync-all-prices-job') ORDER BY start_time DESC LIMIT 10;

-- To unschedule the job (if needed):
-- SELECT cron.unschedule('sync-all-prices-job');

-- Schedule the Gap Protection autofill to run every 10 minutes.
-- Mirrors setup_pg_cron.sql. Requires pg_cron + the service_role key setting.
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;

-- Prereq (run once in SQL editor, same key used by setup_pg_cron.sql):
--   ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key';

SELECT cron.schedule(
  'gap-autofill-job',
  '*/10 * * * *',                 -- every 10 minutes
  $$
  SELECT net.http_post(
    url := 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/gap-autofill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verify:        SELECT * FROM cron.job WHERE jobname = 'gap-autofill-job';
-- Unschedule:    SELECT cron.unschedule('gap-autofill-job');

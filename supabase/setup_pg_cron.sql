-- Enable pg_cron extension (requires Supabase Pro plan)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres role
GRANT USAGE ON SCHEMA cron TO postgres;

-- Schedule sync-all-availability to run every 2 minutes
-- This will call the Edge Function automatically
SELECT cron.schedule(
  'sync-all-availability-job',  -- Job name
  '*/2 * * * *',                -- Cron expression: every 2 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://uopdrhgkephrtpdxicts.supabase.co/functions/v1/sync-all-availability',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- IMPORTANT: Before running the above schedule command, you need to set the service role key.
-- Run this command in the Supabase SQL Editor:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-service-role-key-here';
--
-- To get your service role key:
-- 1. Go to Supabase Dashboard -> Settings -> API
-- 2. Copy the "service_role" secret key
-- 3. Replace 'your-service-role-key-here' with your actual key
-- 4. Run the ALTER DATABASE command above
-- 5. Then run the SELECT cron.schedule command

-- To verify the job was created:
SELECT * FROM cron.job;

-- To see job run history:
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- To unschedule the job (if needed):
-- SELECT cron.unschedule('sync-all-availability-job');

-- Persist the push rate-plan selection in the DB so the server-side autofill
-- cron can target the same rate plans the operator chose in the UI (previously
-- this lived only in browser localStorage, invisible to the cron).
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS push_rate_plan_ids UUID[] DEFAULT '{}';

COMMENT ON COLUMN properties.push_rate_plan_ids IS
  'Rate plan ids to push CTA/CTD/MIN to (shared by manual push UI and gap autofill cron).';

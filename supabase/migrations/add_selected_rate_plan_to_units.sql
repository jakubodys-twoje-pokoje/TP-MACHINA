-- Add selected_rate_plan_id to units for per-unit rate plan selection (platform-wide)
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS selected_rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL;

-- Add selected_rate_plan_id to properties for platform-wide rate plan selection
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS selected_rate_plan_id UUID REFERENCES rate_plans(id) ON DELETE SET NULL;

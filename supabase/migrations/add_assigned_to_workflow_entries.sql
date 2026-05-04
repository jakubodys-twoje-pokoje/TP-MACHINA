-- Add assigned_to column to workflow_entries
ALTER TABLE workflow_entries
ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT NULL;

COMMENT ON COLUMN workflow_entries.assigned_to IS 'Person responsible for this workflow entry';

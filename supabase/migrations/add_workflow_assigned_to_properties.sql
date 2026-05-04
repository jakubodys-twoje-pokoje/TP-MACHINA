-- Add workflow_assigned_to column to properties table
-- This allows assigning a person responsible for the property (opiekun)

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS workflow_assigned_to TEXT DEFAULT NULL;

COMMENT ON COLUMN properties.workflow_assigned_to IS 'Person responsible for this property (opiekun) in workflow view';

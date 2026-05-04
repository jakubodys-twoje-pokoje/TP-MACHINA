-- Create workflow_entry_history table to track changes to workflow entries
-- This allows auditing and viewing historical changes with reasons

CREATE TABLE IF NOT EXISTS workflow_entry_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID REFERENCES workflow_entries(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  task_id UUID NOT NULL,

  -- Previous values
  old_status_id UUID DEFAULT NULL,
  old_comment TEXT DEFAULT NULL,
  old_assigned_to TEXT DEFAULT NULL,

  -- New values
  new_status_id UUID DEFAULT NULL,
  new_comment TEXT DEFAULT NULL,
  new_assigned_to TEXT DEFAULT NULL,

  -- Change metadata
  change_reason TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE workflow_entry_history ENABLE ROW LEVEL SECURITY;

-- Platform-wide access (all authenticated users can view history)
CREATE POLICY "Authenticated users can view workflow entry history"
  ON workflow_entry_history
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert workflow entry history"
  ON workflow_entry_history
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Add indexes for faster querying
CREATE INDEX idx_workflow_entry_history_entry_id ON workflow_entry_history(entry_id);
CREATE INDEX idx_workflow_entry_history_property_task ON workflow_entry_history(property_id, task_id);
CREATE INDEX idx_workflow_entry_history_changed_at ON workflow_entry_history(changed_at DESC);

COMMENT ON TABLE workflow_entry_history IS 'Audit log of changes to workflow entries with reasons';
COMMENT ON COLUMN workflow_entry_history.change_reason IS 'User-provided reason for the change';
COMMENT ON COLUMN workflow_entry_history.changed_by_email IS 'Email of user who made the change';

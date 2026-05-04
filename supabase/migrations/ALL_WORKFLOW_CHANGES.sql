-- ========================================================================
-- WSZYSTKIE ZMIANY WORKFLOW - DO WYKONANIA W SUPABASE SQL EDITOR
-- ========================================================================
-- Ten plik zawiera wszystkie migracje z tej sesji w odpowiedniej kolejności.
-- Skopiuj całość i wykonaj w Supabase SQL Editor.
-- ========================================================================

-- ========================================================================
-- 1. MAKE WORKFLOW_TASKS AND WORKFLOW_STATUSES PLATFORM-WIDE
-- ========================================================================
-- Make workflow_tasks and workflow_statuses platform-wide (shared by all authenticated users)
-- Previously these tables had user_id-based RLS policies that restricted access per user.
-- Now all authenticated users can read and manage all tasks and statuses.

-- =====================
-- workflow_tasks
-- =====================

-- Drop old per-user policies (try common names)
DROP POLICY IF EXISTS "Users can manage their own workflow tasks" ON workflow_tasks;
DROP POLICY IF EXISTS "Users can view their own workflow tasks" ON workflow_tasks;
DROP POLICY IF EXISTS "Users can insert their own workflow tasks" ON workflow_tasks;
DROP POLICY IF EXISTS "Users can update their own workflow tasks" ON workflow_tasks;
DROP POLICY IF EXISTS "Users can delete their own workflow tasks" ON workflow_tasks;
DROP POLICY IF EXISTS "Authenticated users can manage workflow tasks" ON workflow_tasks;

-- Enable RLS (in case it wasn't enabled)
ALTER TABLE workflow_tasks ENABLE ROW LEVEL SECURITY;

-- Add platform-wide policy
CREATE POLICY "Authenticated users can manage workflow tasks"
  ON workflow_tasks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Make user_id nullable (keep as audit column)
ALTER TABLE workflow_tasks ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN workflow_tasks.user_id IS 'Audit: user who created the task (not used for access control)';
COMMENT ON TABLE workflow_tasks IS 'Workflow tasks/columns shared platform-wide across all users';

-- =====================
-- workflow_statuses
-- =====================

-- Drop old per-user policies (try common names)
DROP POLICY IF EXISTS "Users can manage their own workflow statuses" ON workflow_statuses;
DROP POLICY IF EXISTS "Users can view their own workflow statuses" ON workflow_statuses;
DROP POLICY IF EXISTS "Users can insert their own workflow statuses" ON workflow_statuses;
DROP POLICY IF EXISTS "Users can update their own workflow statuses" ON workflow_statuses;
DROP POLICY IF EXISTS "Users can delete their own workflow statuses" ON workflow_statuses;
DROP POLICY IF EXISTS "Authenticated users can manage workflow statuses" ON workflow_statuses;

-- Enable RLS (in case it wasn't enabled)
ALTER TABLE workflow_statuses ENABLE ROW LEVEL SECURITY;

-- Add platform-wide policy
CREATE POLICY "Authenticated users can manage workflow statuses"
  ON workflow_statuses
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Make user_id nullable (keep as audit column)
ALTER TABLE workflow_statuses ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN workflow_statuses.user_id IS 'Audit: user who created the status (not used for access control)';
COMMENT ON TABLE workflow_statuses IS 'Workflow statuses shared platform-wide across all users';


-- ========================================================================
-- 2. ADD WORKFLOW_ENTRY_HISTORY TABLE
-- ========================================================================
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


-- ========================================================================
-- 3. ADD WORKFLOW_ASSIGNED_TO TO PROPERTIES
-- ========================================================================
-- Add workflow_assigned_to column to properties table
-- This allows assigning a person responsible for the property (opiekun)

ALTER TABLE properties
ADD COLUMN IF NOT EXISTS workflow_assigned_to TEXT DEFAULT NULL;

COMMENT ON COLUMN properties.workflow_assigned_to IS 'Person responsible for this property (opiekun) in workflow view';


-- ========================================================================
-- DONE!
-- ========================================================================
-- Po wykonaniu sprawdź czy wszystko działa:
-- 1. Sprawdź czy workflow_tasks i workflow_statuses są widoczne dla wszystkich
-- 2. Sprawdź czy tabela workflow_entry_history została utworzona
-- 3. Sprawdź czy properties ma kolumnę workflow_assigned_to
-- ========================================================================

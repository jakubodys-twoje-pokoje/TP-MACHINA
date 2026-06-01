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

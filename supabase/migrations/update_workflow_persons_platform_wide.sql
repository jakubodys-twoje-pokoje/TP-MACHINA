-- Migrate workflow_persons to be platform-wide (not per-user)
-- Run this if you already applied add_workflow_persons.sql

-- Drop old per-user policy
DROP POLICY IF EXISTS "Users can manage their own workflow persons" ON workflow_persons;

-- Remove user_id column (and its foreign key constraint)
ALTER TABLE workflow_persons DROP COLUMN IF EXISTS user_id;

-- Add new platform-wide policy
CREATE POLICY "Authenticated users can manage workflow persons"
  ON workflow_persons
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

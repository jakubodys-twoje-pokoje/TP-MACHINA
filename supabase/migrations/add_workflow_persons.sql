-- Create workflow_persons table (platform-wide, shared by all users)
CREATE TABLE IF NOT EXISTS workflow_persons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE workflow_persons ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read and manage persons (platform-wide)
CREATE POLICY "Authenticated users can manage workflow persons"
  ON workflow_persons
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE workflow_persons IS 'Persons that can be assigned to workflow entries (shared platform-wide)';

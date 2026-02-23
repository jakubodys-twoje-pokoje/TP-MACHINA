-- Create workflow_persons table
CREATE TABLE IF NOT EXISTS workflow_persons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE workflow_persons ENABLE ROW LEVEL SECURITY;

-- Users can only manage their own persons
CREATE POLICY "Users can manage their own workflow persons"
  ON workflow_persons
  FOR ALL
  USING (auth.uid() = user_id);

COMMENT ON TABLE workflow_persons IS 'Persons that can be assigned to workflow entries';

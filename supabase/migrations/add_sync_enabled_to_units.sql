-- Add sync_enabled column to units table
-- Controls whether price update sync is enabled for a specific unit
ALTER TABLE units
ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT true;

-- Add comment
COMMENT ON COLUMN units.sync_enabled IS 'Controls whether price/CTA/CTD sync to Hotres is enabled for this unit';

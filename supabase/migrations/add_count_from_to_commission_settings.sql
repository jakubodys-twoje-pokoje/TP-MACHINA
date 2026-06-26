-- Remember the "licz prowizję od" date per property (run if commission_settings
-- was created before this column existed). Safe to run repeatedly.
ALTER TABLE commission_settings ADD COLUMN IF NOT EXISTS count_from DATE;

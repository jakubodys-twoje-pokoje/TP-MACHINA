-- Manual, platform-wide ordering of units within a property.
--
-- The calendar and the rate-plan matrix listed units alphabetically, which
-- rarely matches how operators think about a property (e.g. Domek nr 10
-- sorting before Domek nr 2). display_order is set from the "Kolejność
-- kwater" modal on the calendar; NULL means "not ordered yet" and such units
-- sort after the ordered ones, alphabetically (order('display_order',
-- nullsFirst: false).order('name') in the app).
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS display_order INTEGER;

COMMENT ON COLUMN units.display_order IS 'Manual position of the unit in calendar/rate-plan views (shared by all users); NULL = unordered, sorts last by name';

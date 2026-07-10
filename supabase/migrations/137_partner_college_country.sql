-- Migration 137: add a country tag to partner_colleges
--
-- Additive only. Lets each partner college (Settings -> Organization -> Partner
-- Colleges) be tagged with a destination country, so the Add Application forms
-- can filter the University picker to only the colleges in the selected country.
-- Stored as plain text (matching how country is already stored on applications
-- and used in the Add Application form's own Country field), not a foreign key.
--   Expected before/after row counts: partner_colleges 10 -> 10 (column added, no rows touched).
--   Rollback: ALTER TABLE partner_colleges DROP COLUMN IF EXISTS country;
--   Applied: stage <PENDING> / prod <PENDING>.

BEGIN;

ALTER TABLE partner_colleges ADD COLUMN IF NOT EXISTS country TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('137_partner_college_country.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

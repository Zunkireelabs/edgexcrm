-- Migration 172: applications.countries (multi-select destination)
--
-- Additive only. Adds a nullable TEXT[] column so an application can carry
-- multiple destination countries instead of exactly one — matching the
-- multi-select "Interested Destination" pattern already used on leads
-- (leads.destinations TEXT[]). Backfills from the existing singular
-- `country` column so current data isn't lost. The old `country` column is
-- left in place untouched (not dropped) — nothing after this migration
-- reads or writes it, but keeping it is a trivial, zero-risk rollback path.
--
--   Expected before/after row counts: applications table row count unchanged
--     (no rows added/removed); every row with country IS NOT NULL gets
--     countries = ARRAY[country], every row with country IS NULL gets '{}'.
--   Rollback: ALTER TABLE applications DROP COLUMN countries; (country column
--     is untouched throughout, so no data is lost by dropping countries).
--   Applied: stage <pending> / prod HELD.

BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS countries TEXT[] NOT NULL DEFAULT '{}';

UPDATE applications
SET countries = ARRAY[country]
WHERE country IS NOT NULL
  AND countries = '{}';

INSERT INTO public.schema_migrations (version) VALUES ('172_application_countries.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 236: Qualification detail columns on leads (Academic Information)
--
-- Extends the per-level academic columns migration 159 already added
-- (see_gpa/see_institution/see_passed_year, plus_two_*, bachelor_*, masters_*)
-- with the richer fields the client's PDF template wants per qualification:
-- Address, Awarding Body, Start Date, End Date, and (from +2 onward)
-- Stream/Faculty/Degree. Each qualification is still exactly one value per
-- lead (not repeatable), so this follows the same flat-columns-on-`leads`
-- pattern as 159, not a new table.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (schema-only, new nullable columns).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS see_address, see_awarding_body,
--     see_start_date, see_end_date, plus_two_address, plus_two_awarding_body,
--     plus_two_start_date, plus_two_end_date, plus_two_stream_faculty,
--     bachelor_address, bachelor_awarding_body, bachelor_start_date, bachelor_end_date,
--     bachelor_stream_faculty, masters_address, masters_awarding_body,
--     masters_start_date, masters_end_date, masters_stream_faculty;
--   NOT YET APPLIED to any database (stage or prod) — written for review only,
--   per this repo's "no DB access" rule. Apply via the normal PR pipeline.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS see_address TEXT,
  ADD COLUMN IF NOT EXISTS see_awarding_body TEXT,
  ADD COLUMN IF NOT EXISTS see_start_date DATE,
  ADD COLUMN IF NOT EXISTS see_end_date DATE,
  ADD COLUMN IF NOT EXISTS plus_two_address TEXT,
  ADD COLUMN IF NOT EXISTS plus_two_awarding_body TEXT,
  ADD COLUMN IF NOT EXISTS plus_two_start_date DATE,
  ADD COLUMN IF NOT EXISTS plus_two_end_date DATE,
  ADD COLUMN IF NOT EXISTS plus_two_stream_faculty TEXT,
  ADD COLUMN IF NOT EXISTS bachelor_address TEXT,
  ADD COLUMN IF NOT EXISTS bachelor_awarding_body TEXT,
  ADD COLUMN IF NOT EXISTS bachelor_start_date DATE,
  ADD COLUMN IF NOT EXISTS bachelor_end_date DATE,
  ADD COLUMN IF NOT EXISTS bachelor_stream_faculty TEXT,
  ADD COLUMN IF NOT EXISTS masters_address TEXT,
  ADD COLUMN IF NOT EXISTS masters_awarding_body TEXT,
  ADD COLUMN IF NOT EXISTS masters_start_date DATE,
  ADD COLUMN IF NOT EXISTS masters_end_date DATE,
  ADD COLUMN IF NOT EXISTS masters_stream_faculty TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('236_lead_qualification_details.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

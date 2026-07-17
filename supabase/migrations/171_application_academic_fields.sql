-- Migration 171: Interested Degree Level + Field of Study on applications
--
-- Additive only. Adds two nullable TEXT columns so a per-application academic
-- interest can be captured (a lead may apply to multiple programs across
-- different degree levels/fields, e.g. one Undergraduate Business application
-- and one separate Postgraduate Engineering application). Values are free-text
-- but sourced client-side from the same study_levels/courses catalogs (mig 160)
-- already used on the lead form — no new taxonomy, no FK (courses/study_levels
-- store display labels, not ids, matching how leads.degree_level/field_of_study
-- already work).
--
--   Expected before/after row counts: 0 rows touched — new nullable columns only.
--   Rollback: ALTER TABLE applications DROP COLUMN degree_level, DROP COLUMN field_of_study;
--   Applied: stage <pending> / prod HELD.

BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS degree_level TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS field_of_study TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('171_application_academic_fields.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

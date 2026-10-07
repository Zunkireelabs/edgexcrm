-- Migration 269: Student guardian name column on leads
--
-- Additive only. Wrapped in BEGIN/COMMIT.
--   Expected before/after row counts: leads: unchanged (schema-only, 1 new nullable column).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS guardian_name;
--   Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).
--
-- education_consultancy: the consent form's "Parent/Guardian Information" section shows ONE guardian
-- ({{parent_name}} / {{guardian_name}}). Staff pick a relationship and, for anyone other than the
-- father/mother, type the guardian's name here. Father/Mother relationships still resolve from
-- father_name / mother_name (migration 234) when this is empty. Same flat-column precedent as 266.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS guardian_name TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('269_lead_guardian_name.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

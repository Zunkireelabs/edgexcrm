-- Migration 159: Academic qualification + test score columns on leads
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (schema-only, new nullable columns).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS see_gpa, see_institution, see_passed_year,
--     plus_two_gpa, plus_two_institution, plus_two_passed_year, bachelor_gpa, bachelor_institution,
--     bachelor_passed_year, masters_gpa, masters_institution, masters_passed_year,
--     ielts_score, pte_score, toefl_score, sat_score, gre_gmat_score;
--   Applied: stage 2026-07-16 (64->81 leads columns) / prod HELD.
--
-- education_consultancy: student academic qualification (per level) + test report scores.
-- Precedent: structured flat columns on shared `leads` table, same pattern as
-- destinations/field_of_study/degree_level (migration 059).

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS see_gpa TEXT,
  ADD COLUMN IF NOT EXISTS see_institution TEXT,
  ADD COLUMN IF NOT EXISTS see_passed_year SMALLINT,
  ADD COLUMN IF NOT EXISTS plus_two_gpa TEXT,
  ADD COLUMN IF NOT EXISTS plus_two_institution TEXT,
  ADD COLUMN IF NOT EXISTS plus_two_passed_year SMALLINT,
  ADD COLUMN IF NOT EXISTS bachelor_gpa TEXT,
  ADD COLUMN IF NOT EXISTS bachelor_institution TEXT,
  ADD COLUMN IF NOT EXISTS bachelor_passed_year SMALLINT,
  ADD COLUMN IF NOT EXISTS masters_gpa TEXT,
  ADD COLUMN IF NOT EXISTS masters_institution TEXT,
  ADD COLUMN IF NOT EXISTS masters_passed_year SMALLINT,
  ADD COLUMN IF NOT EXISTS ielts_score TEXT,
  ADD COLUMN IF NOT EXISTS pte_score TEXT,
  ADD COLUMN IF NOT EXISTS toefl_score TEXT,
  ADD COLUMN IF NOT EXISTS sat_score TEXT,
  ADD COLUMN IF NOT EXISTS gre_gmat_score TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('159_lead_academic_qualification.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

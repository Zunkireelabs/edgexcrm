-- Migration 234: Student "Personal Information" detail columns on leads
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (schema-only, new nullable columns).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS date_of_birth, marital_status, father_name,
--     mother_name, full_address, emergency_contact_name, emergency_contact_phone, passport_number,
--     passport_issued_by, passport_issued_date, passport_expiry_date, citizenship_number,
--     citizenship_issued_by, citizenship_issued_date;
--   NOT YET APPLIED to any database (stage or prod) — written for review only, per this repo's
--   "no DB access" rule. Apply via the normal PR pipeline (deploy-staging.yml auto-applies on merge
--   to stage; prod applies at promotion behind the production-db approval gate).
--
-- education_consultancy: student "Personal Information" section (client PDF template) —
-- passport/citizenship/family/emergency-contact details, one value per lead.
-- Precedent: structured flat columns directly on shared `leads` table, same pattern as academic
-- qualification + test scores (migration 159) and destinations/field_of_study (migration 059).

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS marital_status TEXT,
  ADD COLUMN IF NOT EXISTS father_name TEXT,
  ADD COLUMN IF NOT EXISTS mother_name TEXT,
  ADD COLUMN IF NOT EXISTS full_address TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS passport_number TEXT,
  ADD COLUMN IF NOT EXISTS passport_issued_by TEXT,
  ADD COLUMN IF NOT EXISTS passport_issued_date DATE,
  ADD COLUMN IF NOT EXISTS passport_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS citizenship_number TEXT,
  ADD COLUMN IF NOT EXISTS citizenship_issued_by TEXT,
  ADD COLUMN IF NOT EXISTS citizenship_issued_date DATE;

INSERT INTO public.schema_migrations (version) VALUES ('234_lead_personal_details.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

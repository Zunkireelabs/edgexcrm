-- Migration 266: Student guardian contact columns on leads (guardian phone / email / relationship)
--
-- Additive only. Wrapped in BEGIN/COMMIT.
--   Expected before/after row counts: leads: unchanged (schema-only, 3 new nullable columns).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS guardian_phone, DROP COLUMN IF EXISTS guardian_email,
--     DROP COLUMN IF EXISTS guardian_relationship;
--   Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).
--
-- education_consultancy: the consent form's "Parent/Guardian Information" section
-- ({{guardian_phone}}, {{guardian_email}}, {{guardian_relationship}}). The guardian's NAME is not
-- stored here — it is derived from father_name / mother_name (migration 234) as {{parent_name}}.
-- Same flat-column-on-leads precedent as migration 234.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS guardian_phone TEXT,
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('266_lead_guardian_details.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

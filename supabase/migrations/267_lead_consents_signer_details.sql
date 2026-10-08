-- Migration 267: lead_consents — fields the signer fills in at signing time
--
-- Additive only. Wrapped in BEGIN/COMMIT.
--   Expected before/after row counts: lead_consents: unchanged (schema-only; existing rows get '{}' / NULL).
--   Rollback: ALTER TABLE lead_consents DROP COLUMN IF EXISTS missing_fields, DROP COLUMN IF EXISTS signer_details;
--   Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).
--
-- education_consultancy: when a consent is sent and the student's profile is missing a detail the
-- template uses (passport number, guardian phone, ...), the tag is kept in body_snapshot and its input
-- key listed in missing_fields. The student types it on the public signing page; the values are stored
-- in signer_details and substituted into body_snapshot at signing. The student's lead profile is NOT
-- changed by a public link — these values live with the signed consent only.

BEGIN;

ALTER TABLE lead_consents
  ADD COLUMN IF NOT EXISTS missing_fields TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS signer_details JSONB;

INSERT INTO public.schema_migrations (version) VALUES ('267_lead_consents_signer_details.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

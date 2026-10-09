-- Migration 272: Structured address columns on leads (Student Details > Address)
--
-- Additive only. Wrapped in BEGIN/COMMIT.
--   Expected before/after row counts: leads: unchanged (schema-only, 5 new nullable columns).
--   Rollback: ALTER TABLE leads
--               DROP COLUMN IF EXISTS address_province, DROP COLUMN IF EXISTS address_district,
--               DROP COLUMN IF EXISTS address_municipality, DROP COLUMN IF EXISTS address_ward,
--               DROP COLUMN IF EXISTS address_tole;
--   Applied: stage HELD (rides deploy-staging.yml) / prod HELD (rides the production-db approval gate).
--
-- education_consultancy: the Student Details pop-up replaces the free-text Full Address with a
-- Nepal-style Country > Province > District > Municipality > Ward > Tole picker. The parts are stored
-- here (flat columns, same precedent as 234/266/269); the country reuses the existing leads.country
-- column; and the readable address is still written to leads.full_address, so consent
-- ({{full_address}} / {{street_address}}) and every other reader keep working unchanged.
-- Existing leads keep their typed full_address and have NULL parts until someone edits them.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS address_province     TEXT,
  ADD COLUMN IF NOT EXISTS address_district     TEXT,
  ADD COLUMN IF NOT EXISTS address_municipality TEXT,
  ADD COLUMN IF NOT EXISTS address_ward         TEXT,
  ADD COLUMN IF NOT EXISTS address_tole         TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('272_lead_structured_address.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

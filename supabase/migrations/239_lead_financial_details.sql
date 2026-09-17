-- Migration 239: Financial Information (Sponsor/Study Funding) columns on leads
--
-- Single value per lead (not repeatable) — same flat-columns-on-`leads`
-- pattern as the Personal Information fields (234). Note: this section was
-- NOT part of the client's original PDF template — flagged there as a
-- generic addition ("standard fields... for completeness"), so it may still
-- change pending client confirmation.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (schema-only, new nullable columns).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS sponsor_name,
--     sponsor_relationship, source_of_funds, scholarship_loan;
--   NOT YET APPLIED to any database (stage or prod) — written for review only,
--   per this repo's "no DB access" rule. Apply via the normal PR pipeline.

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sponsor_name TEXT,
  ADD COLUMN IF NOT EXISTS sponsor_relationship TEXT,
  ADD COLUMN IF NOT EXISTS source_of_funds TEXT,
  ADD COLUMN IF NOT EXISTS scholarship_loan TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('239_lead_financial_details.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

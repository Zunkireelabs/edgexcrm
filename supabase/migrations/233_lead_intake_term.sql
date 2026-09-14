-- Migration 233: Lead "Intake" field (education_consultancy admission cycle)
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: leads.intake_term NULL for all existing
--   rows (no backfill source — this is a brand new per-lead value).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS intake_term;
--   Applied: stage HELD / prod HELD.
--
-- Context: client request (Manish, 2026-09-13) — add an "Intake" field to the
-- Lead Profile (e.g. "November 2026", "December 2026", "January 2027") that
-- also works as a leads filter, same as Destination/Level/Course.
--
-- Deliberately reuses the EXISTING "Intake Term" concept already built for
-- Applications (migration 139_intake_months_years.sql: intake_months +
-- intake_years catalogs, joined client-side into one string, e.g.
-- applications.intake_term "September 2027" — migration 057). Adding a new
-- parallel catalog here would duplicate that system; instead this migration
-- only adds the one missing piece — the same field, but on `leads` — and the
-- app layer (this PR) points its Month/Year pickers at the SAME
-- intake_months/intake_years tables Applications already uses. Nothing about
-- applications, intake_months, or intake_years is modified by this migration.
--
-- Not named `intake` (bare) — leads already has an unrelated intake_source/
-- intake_medium/intake_campaign/intake_account family (migration 087,
-- marketing/traffic-source tracking). `intake_term` matches the Applications
-- column name exactly, which is the clearest signal of what it is.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_term TEXT;

DO $$
DECLARE v_before INT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM leads WHERE intake_term IS NOT NULL AND deleted_at IS NULL;
  RAISE NOTICE '233 AFTER: % leads rows have intake_term set (expected 0, new column)', v_before;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('233_lead_intake_term.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

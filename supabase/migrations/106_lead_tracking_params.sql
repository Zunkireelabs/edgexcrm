-- Migration 106: Add form_source column to leads
-- Stores which Admizz page the lead came from (e.g. test-prep, registration, campaign-uk).
-- ref_code already exists in the leads table (referenced in migration 079) — no change needed there.
-- utm_source/medium/campaign already map to intake_source/medium/campaign — no new columns needed.
-- Additive, idempotent, no rollback risk.

BEGIN;

DO $$
DECLARE v_before INT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM leads WHERE form_source IS NOT NULL;
  RAISE NOTICE '106 BEFORE: leads with form_source non-null = %', v_before;
END$$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS form_source TEXT;

DO $$
DECLARE v_col TEXT;
BEGIN
  SELECT column_name INTO v_col
  FROM information_schema.columns
  WHERE table_name = 'leads' AND column_name = 'form_source';
  IF v_col IS NULL THEN
    RAISE EXCEPTION '106 ABORT: form_source column not found after ALTER';
  END IF;
  RAISE NOTICE '106 AFTER: form_source column confirmed on leads table';
END$$;

COMMIT;

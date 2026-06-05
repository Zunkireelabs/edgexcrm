-- ============================================================
-- Migration 031: Add ref_code to leads
-- Purpose: Capture affiliate referral code passed from the
--          admizz iframe form URL (?ref_code=…).
--          Used only by the admizz tenant — nullable for all
--          other tenants.
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- Rollback:
--   DROP INDEX IF EXISTS idx_leads_ref_code;
--   ALTER TABLE leads DROP COLUMN IF EXISTS ref_code;
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS ref_code TEXT;

-- Partial index — only indexes rows that actually have a ref_code.
-- Keeps the index tiny and avoids any cost on the much larger
-- pool of non-affiliate leads.
CREATE INDEX IF NOT EXISTS idx_leads_ref_code
  ON leads(ref_code)
  WHERE ref_code IS NOT NULL;

-- 076_admizz_source_cleanup.sql
-- Admizz (febeb37c-521c-4f29-adbb-0195b2eede88) only.
-- 1. Strip "Admizz Legacy CRM" junk tag from intake_source:
--    - Combined (e.g. "Admizz Legacy CRM | NEB10K") → keep remaining parts
--    - Standalone ("Admizz Legacy CRM") → relabel as "junk leads"
-- 2. Register "Purnima Front Desk" as reconciliation source #10.
-- Rollback: re-run with inverted UPDATE + DELETE on lead_import_sources row.

BEGIN;

-- ── before counts ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_admizz_legacy_count INT;
BEGIN
  SELECT COUNT(*) INTO v_admizz_legacy_count
  FROM leads
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND deleted_at IS NULL
    AND intake_source LIKE '%Admizz Legacy CRM%';

  RAISE NOTICE 'Before: rows containing Admizz Legacy CRM = %', v_admizz_legacy_count;

  IF v_admizz_legacy_count <> 115 THEN
    RAISE EXCEPTION 'Expected 115 rows with Admizz Legacy CRM, got %. Rolling back.', v_admizz_legacy_count;
  END IF;
END $$;

-- ── 1a. Strip "Admizz Legacy CRM" ──────────────────────────────────────────
UPDATE leads
SET intake_source = (
  SELECT COALESCE(NULLIF(string_agg(TRIM(part), ' | '), ''), 'junk leads')
  FROM unnest(string_to_array(intake_source, ' | ')) AS part
  WHERE TRIM(part) <> 'Admizz Legacy CRM'
)
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND deleted_at IS NULL
  AND intake_source LIKE '%Admizz Legacy CRM%';

-- ── after counts ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_remaining    INT;
  v_junk         INT;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM leads
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND deleted_at IS NULL
    AND intake_source LIKE '%Admizz Legacy CRM%';

  SELECT COUNT(*) INTO v_junk
  FROM leads
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND deleted_at IS NULL
    AND intake_source = 'junk leads';

  RAISE NOTICE 'After: rows still containing Admizz Legacy CRM = % (expect 0)', v_remaining;
  RAISE NOTICE 'After: rows with intake_source = ''junk leads'' = % (expect 83)', v_junk;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Admizz Legacy CRM tag not fully removed (% rows remain). Rolling back.', v_remaining;
  END IF;
  IF v_junk <> 83 THEN
    RAISE EXCEPTION 'Expected 83 junk-leads rows, got %. Rolling back.', v_junk;
  END IF;
END $$;

-- ── 1b. Register Purnima Front Desk as source #10 ──────────────────────────
INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows,
   no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88',
   'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1',
   'Purnima Front Desk', 17, 0, 0, 17, 'Front-desk walk-ins', 10)
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;

COMMIT;

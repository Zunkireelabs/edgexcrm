-- 077_admizz_legacy_export_relabel.sql
-- Relabel the 83 "junk leads" (Admizz legacy CRM export, no source file) to a real
-- source name + register it as reconciliation source #11 so the panel reconciles.
-- Rollback: UPDATE back to 'junk leads' + DELETE the lead_import_sources row.

BEGIN;

-- before-guard: exactly 83 'junk leads'
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM leads
  WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
    AND intake_source='junk leads';
  RAISE NOTICE 'Before: junk leads = %', v_n;
  IF v_n <> 83 THEN RAISE EXCEPTION 'Expected 83 junk leads, got %. Rolling back.', v_n; END IF;
END $$;

-- 1. rename
UPDATE leads
SET intake_source = 'Admizz CRM Export (no source)'
WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL
  AND intake_source='junk leads';

-- 2. register as reconciliation source #11 (label MUST match intake_source exactly)
INSERT INTO lead_import_sources
  (tenant_id, staging_list_id, source_label, raw_rows, dropped_rows,
   no_contact_rows, with_contact_rows, notes, sort_order)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88',
   'd1d9ceda-c479-427e-9da8-0ceda5bdc3b1',
   'Admizz CRM Export (no source)', 83, 0, 0, 83,
   'Legacy CRM database export — existed only in the old Admizz CRM (ADMIZZ-#### ids); not in any lead-gen file', 11)
ON CONFLICT (tenant_id, staging_list_id, source_label) DO NOTHING;

-- after-guard
DO $$
DECLARE v_junk INT; v_new INT;
BEGIN
  SELECT COUNT(*) INTO v_junk FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL AND intake_source='junk leads';
  SELECT COUNT(*) INTO v_new FROM leads
   WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND deleted_at IS NULL AND intake_source='Admizz CRM Export (no source)';
  RAISE NOTICE 'After: junk leads = % (expect 0), Admizz CRM Export = % (expect 83)', v_junk, v_new;
  IF v_junk <> 0 THEN RAISE EXCEPTION 'junk leads not fully renamed (% left). Rollback.', v_junk; END IF;
  IF v_new <> 83 THEN RAISE EXCEPTION 'Expected 83 renamed, got %. Rollback.', v_new; END IF;
END $$;

COMMIT;

-- Migration 096: Admizz "New Leads" intake triage list
-- Creates a new staging+intake list so every newly-created Admizz lead lands in
-- "New Leads" first; owner/admin then bulk-moves them to Pre-qualified.
-- Admizz-specific (tenant_id scoped throughout). Additive + idempotent.
--
-- BEFORE:  is_intake=true → Pre-qualified  (leads land there directly)
-- AFTER:   is_intake=true → New Leads      (triage first, then move to Pre-qualified)
--
-- Rollback (manual, in order):
--   DELETE FROM lead_lists WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND slug='new-leads';
--   UPDATE lead_lists SET is_intake=true WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND slug='pre-qualified';

BEGIN;

-- Before snapshot
DO $$
DECLARE v_intake_count int; v_staging_count int;
BEGIN
  SELECT COUNT(*) INTO v_intake_count FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_intake = true;
  SELECT COUNT(*) INTO v_staging_count FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_staging = true;
  RAISE NOTICE '096 BEFORE: intake_lists=%, staging_lists=%', v_intake_count, v_staging_count;
END$$;

-- 1. Insert "New Leads" as both staging (shows in Leads Organise sidebar)
--    and intake (all new leads route here via is_intake=true LIMIT 1).
--    sort_order=8 places it below "Existing Leads (edgeX)" (sort_order=7).
INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_archive, is_intake, is_staging, access)
VALUES (
  'febeb37c-521c-4f29-adbb-0195b2eede88',
  'New Leads',
  'new-leads',
  8,
  false,
  false,
  true,
  true,
  '{"mode":"all"}'::jsonb
)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 2. Remove is_intake from Pre-qualified so exactly one intake list exists.
--    The create-path query is `is_intake=true LIMIT 1`; two intake rows = ambiguous routing.
UPDATE lead_lists
SET is_intake = false
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND slug = 'pre-qualified';

-- After: assert exactly one intake list for Admizz.
DO $$
DECLARE v_intake_count int; v_staging_count int;
BEGIN
  SELECT COUNT(*) INTO v_intake_count FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_intake = true;
  SELECT COUNT(*) INTO v_staging_count FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_staging = true;
  RAISE NOTICE '096 AFTER: intake_lists=%, staging_lists=%', v_intake_count, v_staging_count;
  IF v_intake_count <> 1 THEN
    RAISE EXCEPTION '096 ABORT: expected exactly 1 intake list for Admizz, got %', v_intake_count;
  END IF;
END$$;

COMMIT;

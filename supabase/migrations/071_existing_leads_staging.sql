-- 071_existing_leads_staging.sql
-- Creates the "Existing Leads (edgeX)" staging list for the Admizz tenant.
-- Additive and idempotent (ON CONFLICT DO NOTHING).
-- STAGE ONLY — this list is specific to the edgeX-stage dataset.
--
-- Rollback: DELETE FROM lead_lists WHERE slug='existing-leads-edgex' AND tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88';

BEGIN;

DO $$
DECLARE
  staging_count_before INT;
BEGIN
  SELECT COUNT(*) INTO staging_count_before FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_staging = true;
  RAISE NOTICE '071 BEFORE: staging_lists_for_admizz=%', staging_count_before;
END $$;

INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_archive, is_intake, is_staging, access)
VALUES (
  'febeb37c-521c-4f29-adbb-0195b2eede88',
  'Existing Leads (edgeX)',
  'existing-leads-edgex',
  7,
  false,
  false,
  false,
  true,
  '{"mode":"all"}'::jsonb
)
ON CONFLICT (tenant_id, slug) DO NOTHING;

DO $$
DECLARE
  staging_count_after INT;
BEGIN
  SELECT COUNT(*) INTO staging_count_after FROM lead_lists
  WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88' AND is_staging = true;
  RAISE NOTICE '071 AFTER: staging_lists_for_admizz=%', staging_count_after;
  IF staging_count_after < 2 THEN
    RAISE EXCEPTION '071 ABORT: expected at least 2 staging lists (migration-qc + existing-leads-edgex), got %', staging_count_after;
  END IF;
END $$;

COMMIT;

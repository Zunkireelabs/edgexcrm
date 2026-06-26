-- 072_move_existing_leads_to_staging.sql
-- Moves all non-staging, non-archive, non-converted Admizz leads (~419)
-- into the "Existing Leads (edgeX)" staging list.
-- Empties Admizz's main pipeline view on stage — expected.
-- STAGE ONLY — do not apply to prod without a separate safety snapshot + Sadin approval.
--
-- Rollback: restore list_id per the safety snapshot saved before this migration ran.
--   UPDATE leads SET list_id = <original_list_id> WHERE id = <lead_id>;
-- (The undo set is pasted in the Phase 4 session report.)

BEGIN;

-- Before counts
DO $$
DECLARE
  main_view_count  INT;
  staging_list_count INT;
BEGIN
  SELECT COUNT(*) INTO main_view_count
  FROM leads l
  LEFT JOIN lead_lists ll ON l.list_id = ll.id
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.deleted_at IS NULL
    AND l.converted_at IS NULL
    AND (ll.slug IS NULL OR (NOT ll.is_staging AND NOT ll.is_archive));

  SELECT COUNT(*) INTO staging_list_count
  FROM leads l
  JOIN lead_lists ll ON l.list_id = ll.id
  WHERE ll.slug = 'existing-leads-edgex'
    AND l.deleted_at IS NULL;

  RAISE NOTICE '072 BEFORE: main_view_count=%, existing_leads_edgex_count=%', main_view_count, staging_list_count;
END $$;

-- Move: all non-staging, non-archive, non-converted leads → existing-leads-edgex
UPDATE leads
SET list_id = (
  SELECT id FROM lead_lists
  WHERE slug = 'existing-leads-edgex'
    AND tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
)
WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
  AND deleted_at IS NULL
  AND converted_at IS NULL
  AND (
    list_id IS NULL
    OR list_id IN (
      SELECT id FROM lead_lists
      WHERE tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
        AND NOT is_staging
        AND NOT is_archive
    )
  );

-- After counts
DO $$
DECLARE
  main_view_after  INT;
  staging_after    INT;
  migration_qc     INT;
BEGIN
  SELECT COUNT(*) INTO main_view_after
  FROM leads l
  LEFT JOIN lead_lists ll ON l.list_id = ll.id
  WHERE l.tenant_id = 'febeb37c-521c-4f29-adbb-0195b2eede88'
    AND l.deleted_at IS NULL
    AND l.converted_at IS NULL
    AND (ll.slug IS NULL OR (NOT ll.is_staging AND NOT ll.is_archive));

  SELECT COUNT(*) INTO staging_after
  FROM leads l
  JOIN lead_lists ll ON l.list_id = ll.id
  WHERE ll.slug = 'existing-leads-edgex'
    AND l.deleted_at IS NULL;

  SELECT COUNT(*) INTO migration_qc
  FROM leads l
  JOIN lead_lists ll ON l.list_id = ll.id
  WHERE ll.slug = 'migration-qc'
    AND l.deleted_at IS NULL;

  RAISE NOTICE '072 AFTER: main_view=%, existing_leads_edgex=%, migration_qc=%', main_view_after, staging_after, migration_qc;

  IF main_view_after <> 0 THEN
    RAISE EXCEPTION '072 ABORT: expected main_view=0, got %', main_view_after;
  END IF;
  IF migration_qc <> 6114 THEN
    RAISE NOTICE '072 WARNING: migration-qc count is %, expected ~6114 — verify manually', migration_qc;
  END IF;
END $$;

COMMIT;

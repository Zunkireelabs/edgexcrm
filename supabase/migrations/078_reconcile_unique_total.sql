-- 078_reconcile_unique_total.sql
-- Helper returning the UNIQUE lead count behind reconciliation (dedupes leads in
-- 2+ source files) so the panel total matches the data table / list count instead
-- of the sum-of-files (which double-counts shared leads).
-- Rollback: DROP FUNCTION reconcile_import_sources_unique(UUID, UUID);

BEGIN;

CREATE OR REPLACE FUNCTION reconcile_import_sources_unique(p_tenant UUID, p_staging_list UUID)
RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COUNT(DISTINCT l.id)
  FROM leads l
  CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
  JOIN lead_import_sources lis
    ON lis.tenant_id = l.tenant_id
   AND lis.staging_list_id = p_staging_list
   AND lis.source_label = TRIM(s)
  WHERE l.tenant_id = p_tenant
    AND l.deleted_at IS NULL
    AND l.intake_source IS NOT NULL;
$$;

COMMIT;

-- 073_leads_perf_indexes.sql
-- Additive indexes for the hot leads query paths. No data change, no drops, idempotent.
-- Rollback: DROP INDEX IF EXISTS idx_leads_tenant_created_active, idx_leads_tenant_intake_active,
--           idx_leads_tenant_list_created_active, idx_leads_tenant_pipeline_created_active;
BEGIN;

-- C1 (CRITICAL): the default leads-list query — tenant + active, ordered by created_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created_active
  ON leads (tenant_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

-- C2 (HIGH): intake_source filtering (staging cockpit / import-source views).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_intake_active
  ON leads (tenant_id, intake_source)
  WHERE deleted_at IS NULL;

-- C3: lead-list / staging views — list_id filter + recency sort (partial, sorted).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_list_created_active
  ON leads (tenant_id, list_id, created_at DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

-- C4: pipeline board — pipeline_id filter + recency sort (partial, sorted).
CREATE INDEX IF NOT EXISTS idx_leads_tenant_pipeline_created_active
  ON leads (tenant_id, pipeline_id, created_at DESC)
  WHERE deleted_at IS NULL AND converted_at IS NULL;

COMMIT;

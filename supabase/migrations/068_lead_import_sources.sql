-- 068_lead_import_sources.sql
-- Adds lead_import_sources table (import file manifest per staging list) and
-- the reconcile_import_sources RPC (split-and-count; NEVER use GROUP BY).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS reconcile_import_sources(UUID, UUID);
--   DROP TABLE IF EXISTS lead_import_sources;

BEGIN;

DO $$
DECLARE
  before_count INT;
BEGIN
  SELECT COUNT(*) INTO before_count FROM lead_lists;
  RAISE NOTICE '068 BEFORE: lead_lists=%, lead_import_sources does not exist yet', before_count;
END $$;

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_import_sources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staging_list_id   UUID NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
  source_label      TEXT NOT NULL,
  raw_rows          INT  NOT NULL DEFAULT 0,
  dropped_rows      INT  NOT NULL DEFAULT 0,
  no_contact_rows   INT  NOT NULL DEFAULT 0,
  with_contact_rows INT  NOT NULL DEFAULT 0,
  notes             TEXT,
  sort_order        INT  NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staging_list_id, source_label)
);

CREATE INDEX IF NOT EXISTS idx_import_sources_list ON lead_import_sources (staging_list_id);

ALTER TABLE lead_import_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_sources_select" ON lead_import_sources
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "import_sources_insert" ON lead_import_sources
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "import_sources_update" ON lead_import_sources
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "import_sources_delete" ON lead_import_sources
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_import_sources_updated_at
  BEFORE UPDATE ON lead_import_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Reconciliation RPC (split-and-count, never GROUP BY) ──────────────────
-- Each lead's intake_source may be "A | B | C" — the lead is credited to every
-- component file. Plain GROUP BY would undercount multi-source leads.

CREATE OR REPLACE FUNCTION reconcile_import_sources(p_tenant UUID, p_staging_list UUID)
RETURNS TABLE (
  source_label      TEXT,
  raw_rows          INT,
  dropped_rows      INT,
  no_contact_rows   INT,
  with_contact_rows INT,
  notes             TEXT,
  sort_order        INT,
  in_crm            BIGINT,
  still_in_staging  BIGINT,
  routed_out        BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH exploded AS (
    SELECT
      TRIM(s) AS source_file,
      (l.list_id = p_staging_list) AS in_staging
    FROM leads l
    CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.intake_source IS NOT NULL
  ),
  agg AS (
    SELECT
      source_file,
      COUNT(*)                                    AS in_crm,
      COUNT(*) FILTER (WHERE in_staging)          AS still_in_staging,
      COUNT(*) FILTER (WHERE NOT in_staging)      AS routed_out
    FROM exploded
    GROUP BY source_file
  )
  SELECT
    lis.source_label,
    lis.raw_rows,
    lis.dropped_rows,
    lis.no_contact_rows,
    lis.with_contact_rows,
    lis.notes,
    lis.sort_order,
    COALESCE(a.in_crm, 0)           AS in_crm,
    COALESCE(a.still_in_staging, 0) AS still_in_staging,
    COALESCE(a.routed_out, 0)       AS routed_out
  FROM lead_import_sources lis
  LEFT JOIN agg a ON a.source_file = lis.source_label
  WHERE lis.tenant_id    = p_tenant
    AND lis.staging_list_id = p_staging_list
  ORDER BY lis.sort_order;
$$;

-- ── 3. After counts ───────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl_count INT;
BEGIN
  SELECT COUNT(*) INTO tbl_count FROM lead_import_sources;
  RAISE NOTICE '068 AFTER: lead_import_sources rows=%', tbl_count;
END $$;

COMMIT;

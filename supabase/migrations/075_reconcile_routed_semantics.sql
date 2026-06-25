-- 075_reconcile_routed_semantics.sql
-- "routed" now means "in a non-staging list" (actually in the pipeline), not
-- merely "not in THIS staging list". A lead moved to a SIBLING staging list
-- now correctly counts as still_in_staging, not routed_out.
-- Rollback: re-apply the mig 068 body of reconcile_import_sources.

BEGIN;

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
      COALESCE(ll.is_staging, FALSE) AS in_staging   -- in ANY staging list?
    FROM leads l
    LEFT JOIN lead_lists ll ON ll.id = l.list_id
    CROSS JOIN LATERAL unnest(string_to_array(l.intake_source, ' | ')) AS s
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.intake_source IS NOT NULL
  ),
  agg AS (
    SELECT
      source_file,
      COUNT(*)                               AS in_crm,
      COUNT(*) FILTER (WHERE in_staging)     AS still_in_staging,
      COUNT(*) FILTER (WHERE NOT in_staging) AS routed_out
    FROM exploded
    GROUP BY source_file
  )
  SELECT
    lis.source_label, lis.raw_rows, lis.dropped_rows, lis.no_contact_rows,
    lis.with_contact_rows, lis.notes, lis.sort_order,
    COALESCE(a.in_crm, 0), COALESCE(a.still_in_staging, 0), COALESCE(a.routed_out, 0)
  FROM lead_import_sources lis
  LEFT JOIN agg a ON a.source_file = lis.source_label
  WHERE lis.tenant_id = p_tenant
    AND lis.staging_list_id = p_staging_list
  ORDER BY lis.sort_order;
$$;

COMMIT;

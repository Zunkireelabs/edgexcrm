-- 101_get_scoped_leads_rpc.sql
-- Fixes silent lead-visibility loss for own-scope/branch-scope users who have
-- personally touched >300 leads. The old fix widened own-scope visibility by
-- pulling lead_collaborators/lead_branches rows into a client-built ID array,
-- then capped that array at INLINE_ID_CAP=300 (src/lib/leads/collaborators.ts)
-- to stay under Node/undici's ~16KB GET URL limit for a PostgREST .in() filter.
-- That cap silently drops legitimately-visible leads for prolific staff —
-- contradicts migration 090's documented intent ("retain VIEW access... even
-- after it is reassigned").
--
-- Fix: move the ENTIRE filtered/sorted/paginated leads query — including the
-- visibility predicate — into one SECURITY DEFINER RPC. No client-built ID
-- array, ever; the EXISTS-based predicate is evaluated in SQL per row, so
-- there's no array to cap. Reused by src/app/(main)/api/v1/leads/route.ts
-- (GET) and src/lib/supabase/queries.ts (getLeads, getLeadsForPipeline) for
-- the own-scope ('self') and branch-scope ('branch') paths only — the
-- unrestricted "all"-scope/admin path never built a capped array and is left
-- untouched in all three call sites.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_scoped_leads(
--     UUID, TEXT, UUID, UUID, UUID[], UUID[], UUID, UUID[], TEXT, TEXT,
--     BOOLEAN, BOOLEAN, BOOLEAN, TEXT, UUID, INT, INT
--   );

BEGIN;

CREATE OR REPLACE FUNCTION public.get_scoped_leads(
  p_tenant_id UUID,
  p_scope_mode TEXT,                       -- 'self' | 'branch'
  p_user_id UUID,
  p_branch_id UUID DEFAULT NULL,
  p_branch_member_ids UUID[] DEFAULT NULL, -- 'branch' mode: tenant_users.user_id for the branch (small set, never capped)
  p_pipeline_ids UUID[] DEFAULT NULL,      -- NULL = no pipeline restriction
  p_list_id UUID DEFAULT NULL,
  p_exclude_list_ids UUID[] DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_include_converted BOOLEAN DEFAULT FALSE,
  p_only_deleted BOOLEAN DEFAULT FALSE,     -- recycle bin: deleted_at IS NOT NULL instead of IS NULL
  p_require_stage BOOLEAN DEFAULT FALSE,    -- pipeline/kanban board: stage_id IS NOT NULL
  p_order_by TEXT DEFAULT 'last_activity_at', -- 'last_activity_at' | 'created_at'
  p_assigned_to UUID DEFAULT NULL,          -- 'branch' mode only: further narrow to one branch member
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT l.*
    FROM leads l
    WHERE l.tenant_id = p_tenant_id
      AND (CASE WHEN p_only_deleted THEN l.deleted_at IS NOT NULL ELSE l.deleted_at IS NULL END)
      AND (p_include_converted OR l.converted_at IS NULL)
      AND (NOT p_require_stage OR l.stage_id IS NOT NULL)
      AND (
        (p_scope_mode = 'self' AND (
          l.assigned_to = p_user_id
          OR EXISTS (SELECT 1 FROM lead_collaborators lc WHERE lc.lead_id = l.id AND lc.user_id = p_user_id)
          OR EXISTS (SELECT 1 FROM lead_branches lb WHERE lb.lead_id = l.id AND lb.assigned_to = p_user_id)
        ))
        OR (p_scope_mode = 'branch' AND (
          (p_branch_member_ids IS NOT NULL AND l.assigned_to = ANY (p_branch_member_ids))
          OR (l.assigned_to IS NULL AND p_branch_id IS NOT NULL AND l.branch_id = p_branch_id)
        ))
      )
      AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
      AND (p_pipeline_ids IS NULL OR l.pipeline_id = ANY (p_pipeline_ids))
      AND (
        CASE
          WHEN p_list_id IS NOT NULL THEN l.list_id = p_list_id
          WHEN p_exclude_list_ids IS NOT NULL THEN (l.list_id IS NULL OR NOT (l.list_id = ANY (p_exclude_list_ids)))
          ELSE TRUE
        END
      )
      AND (p_status IS NULL OR l.status = p_status)
      AND (
        p_search IS NULL OR p_search = '' OR (
          l.first_name ILIKE '%' || p_search || '%'
          OR l.last_name ILIKE '%' || p_search || '%'
          OR l.email ILIKE '%' || p_search || '%'
          OR l.phone ILIKE '%' || p_search || '%'
        )
      )
  ),
  counted AS (
    SELECT f.*, count(*) OVER () AS total_count
    FROM filtered f
    ORDER BY
      CASE WHEN p_order_by = 'created_at' THEN f.created_at END DESC NULLS LAST,
      CASE WHEN p_order_by = 'last_activity_at' THEN f.last_activity_at END DESC NULLS LAST,
      f.id DESC
    LIMIT GREATEST(p_page_size, 0)
    OFFSET (GREATEST(p_page, 1) - 1) * GREATEST(p_page_size, 0)
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(counted) - 'total_count') FROM counted), '[]'::jsonb),
    'total', COALESCE((SELECT MAX(total_count) FROM counted), 0)
  );
$$;

-- Server-only, exactly like 070_restrict_reconcile_rpc.sql: SECURITY DEFINER +
-- PUBLIC-executable would let an authenticated user pass an arbitrary p_tenant_id
-- and read cross-tenant leads. Helper uses the service client, so this is non-breaking.
REVOKE EXECUTE ON FUNCTION public.get_scoped_leads(
  UUID, TEXT, UUID, UUID, UUID[], UUID[], UUID, UUID[], TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, UUID, INT, INT
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_scoped_leads(
  UUID, TEXT, UUID, UUID, UUID[], UUID[], UUID, UUID[], TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, UUID, INT, INT
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scoped_leads(
  UUID, TEXT, UUID, UUID, UUID[], UUID[], UUID, UUID[], TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, TEXT, UUID, INT, INT
) TO service_role;

COMMIT;

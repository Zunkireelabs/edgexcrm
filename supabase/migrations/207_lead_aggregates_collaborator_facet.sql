-- Migration 207: lead_aggregates() — add a 'collaborator' dimension
--
-- ADVANCED-FILTERS-BRIEF Phase 3 addendum §C deliberately deferred a server-side
-- Collaborators facet ("collaborators come from a join table and that's a bigger
-- change... keep the existing client-side collaborator count"). leads-table.tsx's
-- collaboratorCounts is computed from `localLeads` — the current 25-row server page
-- only — so the Advanced Filters "Collaborators" picker (and the legacy toolbar
-- dropdown it mirrors) lists/counts collaborators who happen to be on the loaded
-- page, not tenant-wide. This closes that gap the same way migration 194 closed it
-- for Assigned To: add a 'collaborator' dimension to lead_aggregates(), grouped by
-- lead_collaborators.user_id, computed over the identical visibility + filter
-- predicate every other dimension already uses.
--
-- CREATE OR REPLACE, same signature as migration 194 (no new params) — the new
-- dimension is just one more UNION ALL branch off the existing `v` CTE.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: re-apply migration 194 (CREATE OR REPLACE back to the prior body).
--   Applied: stage <PENDING> / prod HELD (194 itself is prod-HELD — see its header).

BEGIN;

CREATE OR REPLACE FUNCTION public.lead_aggregates(
  p_tenant             uuid,
  p_week1_start        timestamptz,
  p_week2_start        timestamptz,
  p_user               uuid    DEFAULT NULL,
  p_scope              text    DEFAULT 'own',
  p_branch_id          uuid    DEFAULT NULL,
  p_user_branch_id     uuid    DEFAULT NULL,
  p_cross_pool_slug    text    DEFAULT NULL,
  p_pipeline_ids       uuid[]  DEFAULT NULL,
  p_exclude_other_type boolean DEFAULT false,
  p_ids_any_assigned_to uuid[]  DEFAULT NULL,
  p_ids_any_lead_id     uuid[]  DEFAULT NULL,
  p_status_eq          text    DEFAULT NULL,
  p_assignees_any       uuid[]  DEFAULT NULL,
  p_include_unassigned boolean DEFAULT false,
  p_shared_pool_assigned_to_any uuid[] DEFAULT NULL,
  p_collaborator_ids   uuid[]  DEFAULT NULL,
  p_tag                text    DEFAULT NULL,
  p_prospect_industry  text    DEFAULT NULL,
  p_prospect_industry_none boolean DEFAULT false,
  p_form_config_id     uuid    DEFAULT NULL,
  p_created_after      timestamptz DEFAULT NULL,
  p_list_id_eq         uuid    DEFAULT NULL,
  p_list_id_any        uuid[]  DEFAULT NULL,
  p_exclude_list_ids   uuid[]  DEFAULT NULL,
  p_search             text    DEFAULT NULL,
  p_include_converted  boolean DEFAULT false
)
RETURNS TABLE (dimension text, key text, bucket text, cnt bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT l.*
    FROM public.leads l
    WHERE l.tenant_id = p_tenant
      AND EXISTS (SELECT 1 FROM public.tenant_users me
                  WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant)
      AND (
        p_scope IN ('all', 'ids_any')
        OR l.id IN (
          SELECT lv.id FROM public.leads_visible_to_user(
            p_tenant, p_user, p_scope, p_branch_id, p_user_branch_id, p_cross_pool_slug) lv
        )
      )
      AND (
        p_scope <> 'ids_any'
        OR (
          (p_ids_any_assigned_to IS NOT NULL AND l.assigned_to = ANY(p_ids_any_assigned_to))
          OR (p_ids_any_lead_id IS NOT NULL AND l.id = ANY(p_ids_any_lead_id))
        )
      )
      AND (p_shared_pool_assigned_to_any IS NULL OR l.assigned_to = ANY(p_shared_pool_assigned_to_any))
      AND l.deleted_at IS NULL
      AND (p_include_converted OR l.converted_at IS NULL)
      AND (p_pipeline_ids IS NULL OR l.pipeline_id = ANY(p_pipeline_ids))
      AND (p_exclude_other_type = false OR NOT (l.tags @> ARRAY['other']))
      AND (p_status_eq IS NULL OR l.status = p_status_eq)
      AND (
        (p_assignees_any IS NULL AND NOT p_include_unassigned)
        OR (p_assignees_any IS NOT NULL AND l.assigned_to = ANY(p_assignees_any))
        OR (p_include_unassigned AND l.assigned_to IS NULL)
      )
      AND (
        p_collaborator_ids IS NULL
        OR EXISTS (SELECT 1 FROM public.lead_collaborators lc
                   WHERE lc.lead_id = l.id AND lc.tenant_id = p_tenant
                     AND lc.user_id = ANY(p_collaborator_ids))
      )
      AND (p_tag IS NULL OR l.tags @> ARRAY[p_tag])
      AND (
        CASE
          WHEN p_prospect_industry_none THEN l.prospect_industry IS NULL
          WHEN p_prospect_industry IS NOT NULL THEN l.prospect_industry = p_prospect_industry
          ELSE true
        END
      )
      AND (p_form_config_id IS NULL OR l.form_config_id = p_form_config_id)
      AND (p_created_after IS NULL OR l.created_at >= p_created_after)
      AND (p_list_id_eq IS NULL OR l.list_id = p_list_id_eq)
      AND (p_list_id_any IS NULL OR l.list_id = ANY(p_list_id_any))
      AND (
        p_exclude_list_ids IS NULL
        OR l.list_id IS NULL
        OR NOT (l.list_id = ANY(p_exclude_list_ids))
      )
      AND (
        p_search IS NULL
        OR l.first_name ILIKE '%' || p_search || '%'
        OR l.last_name  ILIKE '%' || p_search || '%'
        OR l.email      ILIKE '%' || p_search || '%'
        OR l.phone      ILIKE '%' || p_search || '%'
      )
  )
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'this_week', count(*) FROM v
    WHERE created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'last_week', count(*) FROM v
    WHERE created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  UNION ALL
  SELECT 'stage', stage_id::text, 'all', count(*) FROM v WHERE stage_id IS NOT NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage', stage_id::text, 'this_week', count(*) FROM v
    WHERE stage_id IS NOT NULL AND created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage', stage_id::text, 'last_week', count(*) FROM v
    WHERE stage_id IS NOT NULL AND created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'all', count(*) FROM v
    WHERE stage_id IS NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'this_week', count(*) FROM v
    WHERE stage_id IS NULL AND created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'last_week', count(*) FROM v
    WHERE stage_id IS NULL AND created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  UNION ALL
  SELECT 'source_combo',
         coalesce(form_config_id::text,'') || chr(31) || coalesce(intake_source,''),
         'all', count(*)
  FROM v GROUP BY 1,2,3

  UNION ALL
  SELECT 'counselor', coalesce(assigned_to::text,'(unassigned)'), 'all', count(*) FROM v GROUP BY 1,2,3

  -- ── NEW: collaborator. lead_collaborators has UNIQUE(lead_id, user_id) (migration
  -- 090), so this join produces at most one row per (lead, collaborator) pair —
  -- count(*) after GROUP BY user_id is an exact per-collaborator lead count, the
  -- same shape as the 'counselor' dimension above. A lead with zero collaborator
  -- rows contributes nothing (inner join, by design — there is no "(none)" sentinel
  -- for this axis, unlike counselor's "(unassigned)").
  UNION ALL
  SELECT 'collaborator', lc.user_id::text, 'all', count(*)
  FROM v
  JOIN public.lead_collaborators lc ON lc.lead_id = v.id AND lc.tenant_id = p_tenant
  GROUP BY 1,2,3

  UNION ALL
  SELECT 'list', coalesce(list_id::text,'(none)'), 'all', count(*) FROM v GROUP BY 1,2,3

  UNION ALL
  SELECT 'list_status',
         coalesce(list_id::text,'(none)') || chr(31) || coalesce(nullif(status,''),'unknown'),
         'all', count(*)
  FROM v GROUP BY 1,2,3

  UNION ALL
  SELECT 'intake_source', trim(intake_source), 'all', count(*)
  FROM v
  WHERE intake_source IS NOT NULL AND trim(intake_source) <> ''
  GROUP BY 1,2,3

  UNION ALL
  SELECT 'intake_source_part', trim(part), 'all', count(*)
  FROM v, unnest(string_to_array(v.intake_source, ' | ')) AS part
  WHERE v.intake_source IS NOT NULL AND trim(part) <> ''
  GROUP BY 1,2,3;
$$;

GRANT EXECUTE ON FUNCTION public.lead_aggregates(
  uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean,
  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean
) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('207_lead_aggregates_collaborator_facet.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

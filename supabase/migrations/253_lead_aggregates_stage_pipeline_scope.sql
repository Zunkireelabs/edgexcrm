-- Migration 253: lead_aggregates() — add stage + pipeline scope params
--
-- Why: the Source/Destination facets (and the classic Kanban's facets) are computed by
-- lead_aggregates(), which had no way to restrict to one stage or one pipeline. So a `?stage=`
-- filter narrowed the lead LIST but not these counts — the count-vs-rows mismatch a client
-- reported — and the app had to hide those counts ("no number") whenever a Stage filter was on.
-- p_stage_eq / p_pipeline_eq close that gap: the same `stage_id = X` / `pipeline_id = X`
-- predicates the list route applies (.eq("stage_id"), .eq("pipeline_id")).
--
-- SIGNATURE CHANGE — read before editing: adding parameters means the OLD 27-arg function and a
-- new 29-arg one would coexist as overloads, and because every parameter is defaulted, a call
-- that names only the old parameters would match BOTH and fail with "could not choose the best
-- candidate function". So this migration DROPs the old signature and CREATEs the new one in ONE
-- transaction (callers never see zero or two). The two new parameters are appended and default to
-- NULL, so every existing named-argument caller (src/lib/leads/aggregates.ts) keeps working
-- unchanged, before or after the app code that uses the new params deploys.
--
-- Body is otherwise byte-identical to migration 229 (only the two new WHERE predicates in the
-- `v` CTE are added). p_stage_eq / p_pipeline_eq = NULL => no extra restriction => identical
-- results to 229 for every existing caller (dashboards, insights, Kanban SSR seeds).
--
-- Additive in effect (new optional behavior only). Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION public.lead_aggregates(<29-arg signature below>); then re-apply
--             migration 229 (recreates the 27-arg function). Do both in one transaction.
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

-- The exact old (migration 229) signature. IF EXISTS keeps a re-run a no-op.
DROP FUNCTION IF EXISTS public.lead_aggregates(
  uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean,
  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean
);

-- Idempotent re-run safety: also drop the NEW signature if a previous run created it.
DROP FUNCTION IF EXISTS public.lead_aggregates(
  uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean,
  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean,uuid,uuid
);

CREATE FUNCTION public.lead_aggregates(
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
  p_include_converted  boolean DEFAULT false,
  p_stage_eq           uuid    DEFAULT NULL,
  p_pipeline_eq        uuid    DEFAULT NULL
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
      AND (p_stage_eq IS NULL OR l.stage_id = p_stage_eq)
      AND (p_pipeline_eq IS NULL OR l.pipeline_id = p_pipeline_eq)
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

  UNION ALL
  SELECT 'collaborator', lc.user_id::text, 'all', count(*)
  FROM v
  JOIN public.lead_collaborators lc ON lc.lead_id = v.id AND lc.tenant_id = p_tenant
  GROUP BY 1,2,3

  -- destination — unions the real destinations[] column with the legacy
  -- custom_fields.countries scalar leg before unnesting (migration 229), so
  -- this count matches what the actual filter predicate (real column OR
  -- legacy leg — compile.ts's renderPromotedPredicate) returns. A lead present
  -- in BOTH sources for the SAME value still collapses to one row under
  -- count(DISTINCT v.id) — no double-counting.
  UNION ALL
  SELECT 'destination', trim(dest), 'all', count(DISTINCT v.id)
  FROM v,
       unnest(
         v.destinations ||
         CASE WHEN coalesce(nullif(trim(v.custom_fields->>'countries'), ''), '') <> ''
              THEN ARRAY[v.custom_fields->>'countries']
              ELSE ARRAY[]::text[]
         END
       ) AS dest
  WHERE trim(dest) <> ''
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
  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean,uuid,uuid
) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('253_lead_aggregates_stage_pipeline_scope.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

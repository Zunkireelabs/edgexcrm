-- Migration 229: lead_aggregates() — destination facet counts the legacy
-- custom_fields.countries leg too, matching what the filter actually queries
--
-- Additive only (CREATE OR REPLACE FUNCTION, same signature, body otherwise
-- byte-identical to migration 208 except the one destination branch below).
-- Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: re-apply migration 208 (CREATE OR REPLACE back to its body).
--   Applied: stage HELD / prod HELD.
--
-- Context: client-reported (2026-09-07 screenshot) — selecting "UK (4)" from the
-- Destinations filter returned 18 leads, not 4. Root cause: migration 208's
-- destination facet only unnests leads.destinations (the real column). But the
-- filter's own predicate (src/lib/filters/compile.ts's renderPromotedPredicate,
-- for a "promoted" field) ORs TWO legs: the real column AND
-- custom_fields->>'countries' (the legacy fallback — see leads.ts registry's
-- `jsonb: { column: "custom_fields", path: "countries" }`). That OR exists on
-- purpose so leads whose data only ever landed in the legacy field don't vanish
-- from search — but the facet count was never taught about that second leg, so
-- it always undercounts relative to what clicking the checkbox actually returns.
--
-- Fix: union in the legacy scalar leg before unnesting, so both sources feed the
-- same count(DISTINCT v.id) — a lead present in BOTH sources for the SAME
-- destination value collapses to one row under DISTINCT, so this does not
-- double-count. Deliberately only 'countries' (compile.ts's one actual read
-- key), not all 9 write-time synonym keys in destination-normalize.ts's
-- DESTINATION_SYNONYM_KEYS — those other 8 are folded into the real
-- `destinations` column at WRITE time only and are never independently read by
-- the filter query, so counting them here would count leads the filter itself
-- can never actually match.
--
-- Display-side merging of decoration-only duplicates (e.g. "UK" / "🇬🇧 UK")
-- stays in src/lib/leads/aggregates.ts's getDestinationFacet() — not
-- reimplemented here in SQL (Postgres's regex engine cannot portably match
-- \p{Regional_Indicator}, the flag-emoji codepoint class stripDecoration()
-- relies on — the same trap that codebase already documents).

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
  uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean
) TO authenticated;

INSERT INTO public.schema_migrations (version) VALUES ('229_lead_aggregates_destination_legacy_leg.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 194: lead_aggregates() — Postgres-side counts for dashboard/insights/pipeline
-- + the /leads source facet (ADDENDUM, same migration per brief instruction).
--
-- Additive only (new function + grant). Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: 0 rows touched (function DDL only).
--   Rollback: DROP FUNCTION IF EXISTS public.lead_aggregates(uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean,uuid[],uuid[],text,uuid[],boolean,uuid[],uuid[],text,text,boolean,uuid,timestamptz,uuid,uuid[],uuid[],text,boolean);
--   Applied: stage 2026-08-01 / prod HELD (this migration is stage-only, see DASHBOARD-AGGREGATES-BRIEF.md §6).

BEGIN;

-- The 10-param version of this function (first draft of this same migration, never
-- applied to stage/prod) had a different signature than the one below — DROP it so
-- CREATE OR REPLACE doesn't leave a stale duplicate overload. Harmless no-op once this
-- file has actually shipped with the final signature (IF EXISTS).
DROP FUNCTION IF EXISTS public.lead_aggregates(uuid,timestamptz,timestamptz,uuid,text,uuid,uuid,text,uuid[],boolean);

-- Fixes the dashboard/insights/pipeline correctness bug: those pages compute stat
-- cards, charts, and column counts from getLeads(), which is capped at 1,000 rows
-- (newest-first) — so any tenant over the cap (Admizz, 16.9k leads) sees numbers
-- computed from ~6% of its data and displayed as totals. One GROUP BY round-trip
-- replaces that, per DASHBOARD-AGGREGATES-BRIEF.md.
--
-- ADDENDUM: also serves the /leads Source facet (leads-table.tsx's `sources` /
-- `sourceCounts`, currently built from the current 25-row page only — see the brief's
-- addendum). That endpoint's scope resolution is NOT uniformly leads_visible_to_user()
-- the way dashboard/pipeline are: src/app/(main)/api/v1/leads/route.ts keeps its own
-- hand-rolled branch/shared-pool predicate (deliberately narrower than
-- leads_visible_to_user's branch case — see the comment at that route's query
-- construction). Rather than re-derive that predicate here (the exact kind of second
-- copy this function's own header warns against), the route passes in the SAME
-- pre-resolved id arrays it already computes for its own query (branchMemberIds(),
-- lead_branches lookups) via p_ids_any_assigned_to / p_ids_any_lead_id — this function
-- just applies them, it does not decide who is a branch member.
--
-- Selects FROM public.leads_visible_to_user() (migration 179) for the 'own'/'branch'
-- scopes — never reimplements its WHERE clause; a second copy of that predicate
-- drifting is exactly how a count ends up revealing leads the viewer cannot open.
-- p_scope='all' is a top-level bypass matching the existing "owner/admin, unrestricted"
-- branch in visibleLeadsBase() (src/lib/leads/visibility-query.ts): that branch already
-- runs as a plain `.from("leads")` select via the RLS-respecting client, so it is gated
-- ONLY by RLS's tenant-membership check today, not by role. This function's own
-- EXISTS(tenant_users) check reproduces that exact safety level — it is not a new or
-- wider hole, just the same baseline expressed inside a SECURITY DEFINER body.
-- p_scope='ids_any' is the /leads route's OWN branch-scope predicate (see above) —
-- visible iff assigned_to is in p_ids_any_assigned_to OR id is in p_ids_any_lead_id.
--
-- Same null-arg hazard as migration 179 / visibility-query.ts:18-23 — PostgREST
-- serializes a JS `null` RPC arg as the literal string "null", which fails to cast
-- to uuid (22P02). Callers must OMIT a key rather than send an explicit null; every
-- optional param here has a trailing DEFAULT so that omission works.
CREATE OR REPLACE FUNCTION public.lead_aggregates(
  p_tenant             uuid,
  p_week1_start        timestamptz,          -- caller-supplied window boundary (now - 7d); never now() — see §2.1
  p_week2_start        timestamptz,          -- now - 14d
  p_user               uuid    DEFAULT NULL,
  p_scope              text    DEFAULT 'own',  -- 'own' | 'branch' | 'all' | 'ids_any'
  p_branch_id          uuid    DEFAULT NULL,
  p_user_branch_id     uuid    DEFAULT NULL,
  p_cross_pool_slug    text    DEFAULT NULL,
  p_pipeline_ids       uuid[]  DEFAULT NULL,    -- position pipeline-access allowlist (leadQueryScope.pipelineIds); NULL = all
  p_exclude_other_type boolean DEFAULT false,   -- education "other"-tagged contacts; mirrors getLeads(scope.excludeOtherType)
  -- ── /leads route's own hand-rolled branch/shared-pool scope (p_scope='ids_any') ──
  p_ids_any_assigned_to uuid[]  DEFAULT NULL,   -- branch scope: assigned_to IN (...) half of the route's .or(...)
  p_ids_any_lead_id     uuid[]  DEFAULT NULL,   -- branch scope: id IN (...) half (lead_branches shared rows)
  -- ── /leads facet filter mirror — every filter axis that route/GET applies, so the
  --    facet is computed over the identical predicate. All optional, all AND'd in. ──
  p_status_eq          text    DEFAULT NULL,
  p_assignees_any       uuid[]  DEFAULT NULL,   -- route's `assignees` (multi) filter, resolved uuids only
  p_include_unassigned boolean DEFAULT false,   -- route's `assignees` "unassigned" token
  p_shared_pool_assigned_to_any uuid[] DEFAULT NULL, -- shared-pool AND-filter (route: .in("assigned_to", memberIds) under p_scope='all')
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
      -- ── Fail-closed authorization (DEFINER bypasses RLS) ──
      AND EXISTS (SELECT 1 FROM public.tenant_users me
                  WHERE me.user_id = auth.uid() AND me.tenant_id = p_tenant)
      -- ── Visibility gate: delegate to leads_visible_to_user() for own/branch;
      --    'all' is the unrestricted baseline; 'ids_any' is the /leads route's own
      --    hand-rolled branch/shared-pool predicate (pre-resolved ids, not re-derived here) ──
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
      -- Shared-pool AND-narrowing (route: p_scope='all' + .in("assigned_to", memberIds))
      AND (p_shared_pool_assigned_to_any IS NULL OR l.assigned_to = ANY(p_shared_pool_assigned_to_any))
      AND l.deleted_at IS NULL
      AND (p_include_converted OR l.converted_at IS NULL)
      AND (p_pipeline_ids IS NULL OR l.pipeline_id = ANY(p_pipeline_ids))
      AND (p_exclude_other_type = false OR NOT (l.tags @> ARRAY['other']))
      -- ── /leads facet filter mirror (every filter EXCEPT source itself — the caller
      --    omits its own facet's filter, per the brief's "pass every active filter
      --    except source itself") ──
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
  -- status: raw status column. Feeds LeadsByStageChart (always groups by raw status)
  -- and the legacy (no-stages) StatsCards fallback path used by insights dashboards.
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'all', count(*) FROM v GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'this_week', count(*) FROM v
    WHERE created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'status', coalesce(nullif(status,''),'unknown'), 'last_week', count(*) FROM v
    WHERE created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  -- stage: stage_id-keyed. Feeds the stage-driven StatsCards path (matchesStage's
  -- `lead.stage_id === stage.id` branch) used on /dashboard.
  UNION ALL
  SELECT 'stage', stage_id::text, 'all', count(*) FROM v WHERE stage_id IS NOT NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage', stage_id::text, 'this_week', count(*) FROM v
    WHERE stage_id IS NOT NULL AND created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage', stage_id::text, 'last_week', count(*) FROM v
    WHERE stage_id IS NOT NULL AND created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  -- stage_fallback_status: only rows with NO stage_id, keyed by raw status. Feeds
  -- matchesStage's fallback branch (`lead.status === stage.slug`) — a lead with
  -- stage_id set NEVER falls into this bucket, exactly mirroring matchesStage().
  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'all', count(*) FROM v
    WHERE stage_id IS NULL GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'this_week', count(*) FROM v
    WHERE stage_id IS NULL AND created_at >= p_week1_start GROUP BY 1,2,3
  UNION ALL
  SELECT 'stage_fallback_status', coalesce(nullif(status,''),'unknown'), 'last_week', count(*) FROM v
    WHERE stage_id IS NULL AND created_at >= p_week2_start AND created_at < p_week1_start GROUP BY 1,2,3

  -- source_combo: (form_config_id, intake_source) pair, chr(31)-joined. LeadsBySourceChart
  -- resolves the display name per-row as `formMap[form_config_id] || intake_source || "Direct"`
  -- — grouping by the pair (not by form_config_id alone) reproduces that resolution exactly,
  -- including the stale-form_config_id-not-in-formMap edge case, without a second name lookup in SQL.
  UNION ALL
  SELECT 'source_combo',
         coalesce(form_config_id::text,'') || chr(31) || coalesce(intake_source,''),
         'all', count(*)
  FROM v GROUP BY 1,2,3

  -- counselor: raw assigned_to. Name resolution (memberMap/memberNames) stays client-side,
  -- unchanged, in LeadsByCounselorChart.
  UNION ALL
  SELECT 'counselor', coalesce(assigned_to::text,'(unassigned)'), 'all', count(*) FROM v GROUP BY 1,2,3

  -- list: exact per-list-id count. Feeds ListFunnelBoard's column header (replaces
  -- the capped `leads.length`).
  UNION ALL
  SELECT 'list', coalesce(list_id::text,'(none)'), 'all', count(*) FROM v GROUP BY 1,2,3

  -- list_status: (list_id, status) pair. Feeds ListFunnelBoard's per-column status-filter
  -- chip set from the DB instead of from whatever page of leads happened to load.
  UNION ALL
  SELECT 'list_status',
         coalesce(list_id::text,'(none)') || chr(31) || coalesce(nullif(status,''),'unknown'),
         'all', count(*)
  FROM v GROUP BY 1,2,3

  -- ── ADDENDUM: /leads Source facet ──
  -- intake_source: exact string, non-empty only (skips NULL/'' the same way
  -- leads-table.tsx's `sources`/`sourceCounts` skip `if (!l.intake_source) return`).
  -- Used by the non-staging (/leads) view.
  UNION ALL
  SELECT 'intake_source', trim(intake_source), 'all', count(*)
  FROM v
  WHERE intake_source IS NOT NULL AND trim(intake_source) <> ''
  GROUP BY 1,2,3

  -- intake_source_part: intake_source split on " | ", one row per non-empty part —
  -- mirrors leads-table.tsx's staging-view splitting (`l.intake_source.split(" | ")`).
  -- Used by the staging view (isStagingView).
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

INSERT INTO public.schema_migrations (version) VALUES ('194_lead_aggregates.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

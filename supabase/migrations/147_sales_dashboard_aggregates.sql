-- Migration 147: Sales & Outreach dashboard — server-side aggregation RPCs
--
-- Additive only. The it_agency "Sales & Outreach" dashboard (Phase 1 CORE, 6 widgets)
-- must NOT compute funnel/trend/counts from a capped row fetch: getLeads() caps at
-- 1000 rows (PostgREST max-rows) and Zunkiree Labs already has 1,040 leads, so any
-- props-fed aggregation undercounts. These 6 functions COUNT/SUM in the database.
--
-- SECURITY: each function takes an explicit p_tenant (and an optional restrict param
-- for counselor-scoping) and is SECURITY DEFINER so it reads reliably regardless of
-- the caller's RLS grants. That means EXECUTE must be locked to service_role only —
-- otherwise a forged p_tenant would let any authenticated caller read another
-- tenant's aggregates. This mirrors the reconcile_import_sources incident fixed in
-- migration 070 (was PUBLIC-executable; restricted to service_role). All 6 read-only
-- endpoints call these via the service-role client (scopedClient/raw()), never
-- exposed directly to browser-side Supabase clients.
--
--   Expected before/after row counts: 0 rows touched (function definitions only).
--   Rollback:
--     DROP FUNCTION IF EXISTS sales_leads_trend(UUID, UUID, INT);
--     DROP FUNCTION IF EXISTS sales_leads_by_source(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_funnel(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_leads_by_owner(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_aging(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_deals_summary(UUID, UUID);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- 1. New Leads Over Time — leads created per week, last p_weeks weeks (default 12).
CREATE OR REPLACE FUNCTION sales_leads_trend(p_tenant UUID, p_assigned_to UUID DEFAULT NULL, p_weeks INT DEFAULT 12)
RETURNS TABLE (week DATE, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - ((p_weeks - 1) * interval '1 week'),
      date_trunc('week', now()),
      interval '1 week'
    )::date AS week
  )
  SELECT w.week, COUNT(l.id) AS count
  FROM weeks w
  LEFT JOIN leads l
    ON l.tenant_id = p_tenant
    AND l.deleted_at IS NULL
    AND date_trunc('week', l.created_at)::date = w.week
    AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  GROUP BY w.week
  ORDER BY w.week;
$$;

-- 2. Leads by Source — grouped by intake_source (null/blank -> 'Unknown'), desc.
CREATE OR REPLACE FUNCTION sales_leads_by_source(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (source TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(TRIM(l.intake_source), ''), 'Unknown') AS source, COUNT(*) AS count
  FROM leads l
  WHERE l.tenant_id = p_tenant
    AND l.deleted_at IS NULL
    AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  GROUP BY 1
  ORDER BY count DESC;
$$;

-- 3. Pipeline by Stage — leads grouped by lead_lists ("Stage"), excludes archive lists.
CREATE OR REPLACE FUNCTION sales_funnel(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (stage_id UUID, name TEXT, sort_order INT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ll.id AS stage_id, ll.name, ll.sort_order, COUNT(l.id) AS count
  FROM lead_lists ll
  LEFT JOIN leads l
    ON l.list_id = ll.id
    AND l.tenant_id = ll.tenant_id
    AND l.deleted_at IS NULL
    AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  WHERE ll.tenant_id = p_tenant
    AND ll.is_archive = false
  GROUP BY ll.id, ll.name, ll.sort_order
  ORDER BY ll.sort_order;
$$;

-- 4. Leads by Owner — grouped by assigned_to (null -> Unassigned, resolved in the API layer).
CREATE OR REPLACE FUNCTION sales_leads_by_owner(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.assigned_to AS user_id, COUNT(*) AS count
  FROM leads l
  WHERE l.tenant_id = p_tenant
    AND l.deleted_at IS NULL
    AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  GROUP BY l.assigned_to
  ORDER BY count DESC;
$$;

-- 5. Aging / Stale Leads — OPEN leads (list is NULL or not an archive list) bucketed
--    by days since last_activity_at.
CREATE OR REPLACE FUNCTION sales_aging(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (bucket TEXT, count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    CASE
      WHEN now() - l.last_activity_at < interval '8 days'  THEN '0-7'
      WHEN now() - l.last_activity_at < interval '15 days' THEN '8-14'
      WHEN now() - l.last_activity_at < interval '31 days' THEN '15-30'
      ELSE '30+'
    END AS bucket,
    COUNT(*) AS count
  FROM leads l
  LEFT JOIN lead_lists ll ON ll.id = l.list_id
  WHERE l.tenant_id = p_tenant
    AND l.deleted_at IS NULL
    AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
    AND (ll.id IS NULL OR ll.is_archive = false)
  GROUP BY 1;
$$;

-- 6. Deals Snapshot — win rate, open count, weighted pipeline, bookings won (MTD).
--    NOTE: deals has no won_at/closed_at column, so "won this month" is proxied by
--    updated_at (bumped by the updated_at trigger on every write, including the
--    status flip to 'won') falling in the current calendar month. Documented
--    approximation — see brief deviation note.
CREATE OR REPLACE FUNCTION sales_deals_summary(p_tenant UUID, p_owner UUID DEFAULT NULL)
RETURNS TABLE (
  win_rate_pct NUMERIC,
  open_count BIGINT,
  weighted_pipeline NUMERIC,
  bookings_won_mtd NUMERIC,
  currency TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT dl.amount, dl.status, dl.updated_at, dl.currency,
           COALESCE(dl.probability, ds.probability) AS eff_probability
    FROM deals dl
    JOIN deal_stages ds ON ds.id = dl.stage_id
    WHERE dl.tenant_id = p_tenant
      AND dl.deleted_at IS NULL
      AND (p_owner IS NULL OR dl.owner_id = p_owner)
  ),
  cur AS (
    SELECT currency FROM d GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1
  )
  SELECT
    CASE WHEN COUNT(*) FILTER (WHERE status IN ('won','lost')) = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'won')
              / NULLIF(COUNT(*) FILTER (WHERE status IN ('won','lost')), 0), 1)
    END AS win_rate_pct,
    COUNT(*) FILTER (WHERE status = 'open') AS open_count,
    COALESCE(SUM(amount * eff_probability / 100.0) FILTER (WHERE status = 'open'), 0) AS weighted_pipeline,
    COALESCE(SUM(amount) FILTER (WHERE status = 'won' AND updated_at >= date_trunc('month', now())), 0) AS bookings_won_mtd,
    COALESCE((SELECT currency FROM cur), 'NPR') AS currency
  FROM d;
$$;

-- Lock EXECUTE to service_role only (see SECURITY note above).
REVOKE EXECUTE ON FUNCTION sales_leads_trend(UUID, UUID, INT)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_leads_by_source(UUID, UUID)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_funnel(UUID, UUID)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_leads_by_owner(UUID, UUID)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_aging(UUID, UUID)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_deals_summary(UUID, UUID)        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION sales_leads_trend(UUID, UUID, INT)      TO service_role;
GRANT EXECUTE ON FUNCTION sales_leads_by_source(UUID, UUID)       TO service_role;
GRANT EXECUTE ON FUNCTION sales_funnel(UUID, UUID)                TO service_role;
GRANT EXECUTE ON FUNCTION sales_leads_by_owner(UUID, UUID)        TO service_role;
GRANT EXECUTE ON FUNCTION sales_aging(UUID, UUID)                 TO service_role;
GRANT EXECUTE ON FUNCTION sales_deals_summary(UUID, UUID)         TO service_role;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('147_sales_dashboard_aggregates.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

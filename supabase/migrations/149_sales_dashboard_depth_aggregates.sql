-- Migration 149: Sales & Outreach dashboard — depth aggregation RPCs (Phase 1.5)
--
-- Additive only. Companion to migration 147 (CORE 6 RPCs) — same rationale (server-side
-- aggregation so 1,040+ leads aren't undercounted by PostgREST's 1000-row cap) and same
-- SECURITY posture (SECURITY DEFINER + EXECUTE locked to service_role only).
--
-- Source-of-truth choices (documented, see brief deviation notes):
--   * sales_cycle uses leads.created_at -> converted_at, NOT deals.created_at -> close_date.
--     deals.close_date is populated on only 3 of 22 deals for the reference tenant (mostly
--     NULL in practice) which would starve the widget; converted_at is far better populated
--     and is the metric named in the master plan (Section D: "Sales Cycle Length").
--   * sales_first_contact treats ANY lead_activities row as "first contact" (call/email/
--     meeting) — the activity_type enum (migration 014) has no generic "contact" value.
--   * sales_win_loss is all-time (no period filter), mirroring sales_deals_summary's
--     open_count/win_rate_pct (mig 146) — deals has no reliable closed-at column to
--     period-scope by (same gap documented in mig 146's header).
--
--   Expected before/after row counts: 0 rows touched (function definitions only).
--   Rollback:
--     DROP FUNCTION IF EXISTS sales_cycle(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_proposals(UUID);
--     DROP FUNCTION IF EXISTS sales_first_contact(UUID, UUID);
--     DROP FUNCTION IF EXISTS sales_win_loss(UUID, UUID);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- 1. Sales Cycle Length — avg/median days from lead creation to conversion.
CREATE OR REPLACE FUNCTION sales_cycle(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (avg_days NUMERIC, median_days NUMERIC, sample_size BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT EXTRACT(EPOCH FROM (l.converted_at - l.created_at)) / 86400.0 AS days
    FROM leads l
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND l.converted_at IS NOT NULL
      AND l.converted_at >= l.created_at
      AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  )
  SELECT ROUND(AVG(days)::numeric, 1) AS avg_days,
         ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days))::numeric, 1) AS median_days,
         COUNT(*) AS sample_size
  FROM d;
$$;

-- 2. Proposal Engagement — status mix, viewed count, acceptance rate, time-to-view/accept.
CREATE OR REPLACE FUNCTION sales_proposals(p_tenant UUID)
RETURNS TABLE (
  draft_count BIGINT,
  sent_count BIGINT,
  accepted_count BIGINT,
  rejected_count BIGINT,
  expired_count BIGINT,
  viewed_count BIGINT,
  acceptance_rate_pct NUMERIC,
  avg_hours_to_view NUMERIC,
  avg_hours_to_accept NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (
    SELECT pr.id, pr.status, pr.sent_at, pr.accepted_at,
           (SELECT MIN(pv.viewed_at) FROM proposal_views pv WHERE pv.proposal_id = pr.id) AS first_viewed_at
    FROM proposals pr
    WHERE pr.tenant_id = p_tenant
      AND pr.deleted_at IS NULL
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'draft')    AS draft_count,
    COUNT(*) FILTER (WHERE status = 'sent')     AS sent_count,
    COUNT(*) FILTER (WHERE status = 'accepted') AS accepted_count,
    COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_count,
    COUNT(*) FILTER (WHERE status = 'expired')  AS expired_count,
    COUNT(*) FILTER (WHERE first_viewed_at IS NOT NULL) AS viewed_count,
    CASE WHEN COUNT(*) FILTER (WHERE status IN ('sent','accepted','rejected','expired')) = 0 THEN 0
         ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'accepted')
              / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent','accepted','rejected','expired')), 0), 1)
    END AS acceptance_rate_pct,
    ROUND((AVG(EXTRACT(EPOCH FROM (first_viewed_at - sent_at)) / 3600.0)
           FILTER (WHERE first_viewed_at IS NOT NULL AND sent_at IS NOT NULL))::numeric, 1) AS avg_hours_to_view,
    ROUND((AVG(EXTRACT(EPOCH FROM (accepted_at - sent_at)) / 3600.0)
           FILTER (WHERE accepted_at IS NOT NULL AND sent_at IS NOT NULL))::numeric, 1) AS avg_hours_to_accept
  FROM p;
$$;

-- 3. Time to First Contact — avg/median hours from lead creation to earliest activity.
CREATE OR REPLACE FUNCTION sales_first_contact(p_tenant UUID, p_assigned_to UUID DEFAULT NULL)
RETURNS TABLE (avg_hours NUMERIC, median_hours NUMERIC, sample_size BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH first_activity AS (
    SELECT la.lead_id, MIN(la.created_at) AS first_contact_at
    FROM lead_activities la
    WHERE la.tenant_id = p_tenant
    GROUP BY la.lead_id
  ), d AS (
    SELECT EXTRACT(EPOCH FROM (fa.first_contact_at - l.created_at)) / 3600.0 AS hours
    FROM leads l
    JOIN first_activity fa ON fa.lead_id = l.id
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND fa.first_contact_at >= l.created_at
      AND (p_assigned_to IS NULL OR l.assigned_to = p_assigned_to)
  )
  SELECT ROUND(AVG(hours)::numeric, 1) AS avg_hours,
         ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours))::numeric, 1) AS median_hours,
         COUNT(*) AS sample_size
  FROM d;
$$;

-- 4. Win / Loss — won vs lost deal counts + amounts, all-time.
CREATE OR REPLACE FUNCTION sales_win_loss(p_tenant UUID, p_owner UUID DEFAULT NULL)
RETURNS TABLE (won_count BIGINT, lost_count BIGINT, won_amount NUMERIC, lost_amount NUMERIC, currency TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT status, amount, currency
    FROM deals
    WHERE tenant_id = p_tenant
      AND deleted_at IS NULL
      AND status IN ('won','lost')
      AND (p_owner IS NULL OR owner_id = p_owner)
  ), cur AS (
    SELECT currency FROM d GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'won')  AS won_count,
    COUNT(*) FILTER (WHERE status = 'lost') AS lost_count,
    COALESCE(SUM(amount) FILTER (WHERE status = 'won'), 0)  AS won_amount,
    COALESCE(SUM(amount) FILTER (WHERE status = 'lost'), 0) AS lost_amount,
    COALESCE((SELECT currency FROM cur), 'NPR') AS currency
  FROM d;
$$;

-- Lock EXECUTE to service_role only (mirrors migration 147 / the reconcile_import_sources
-- incident fixed in migration 070 — SECURITY DEFINER + p_tenant param must never be
-- PUBLIC-executable, or a forged p_tenant lets any authenticated caller read another
-- tenant's aggregates).
REVOKE EXECUTE ON FUNCTION sales_cycle(UUID, UUID)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_proposals(UUID)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_first_contact(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION sales_win_loss(UUID, UUID)      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION sales_cycle(UUID, UUID)          TO service_role;
GRANT EXECUTE ON FUNCTION sales_proposals(UUID)            TO service_role;
GRANT EXECUTE ON FUNCTION sales_first_contact(UUID, UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION sales_win_loss(UUID, UUID)       TO service_role;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('149_sales_dashboard_depth_aggregates.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

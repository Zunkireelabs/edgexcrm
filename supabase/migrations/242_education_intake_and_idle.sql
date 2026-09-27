-- Migration 242: Team & Lead Performance dashboard — Intake Alarm RPCs
-- (education_consultancy). Two narrow functions backing one widget:
--   education_intake_alarm  — Pre-qualified leads with NO qualifying touch yet,
--                              bucketed by age (0-24h / 24-48h / 48h+).
--   education_idle_staff    — staff who touched zero leads anywhere in the window
--                              (distinct from "this one lead is stuck"). Role
--                              exclusion (owner/admin never flagged) added in
--                              migration 246 — see that file.
--
-- Same canonical "touched" definition as migration 241 — see that file's header.
-- Do not extend either function's touch source without updating the shared
-- regression test (touched-definition.test.ts).
--
--   Expected before/after row counts: 0 rows touched (function definitions only).
--   Rollback:
--     DROP FUNCTION IF EXISTS education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT);
--     DROP FUNCTION IF EXISTS education_idle_staff(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- p_now is passed explicitly (not NOW()) so bucket edges are deterministic and
-- testable against a fixed clock from the caller. p_bucket1_hours/p_bucket2_hours
-- are the tenant's configured alarm thresholds (tenants.config.team_performance_
-- thresholds.intake_alarm_buckets_hours, default [24, 48]) — thresholds are config,
-- never hardcoded, so the caller resolves them and passes them in.
CREATE OR REPLACE FUNCTION education_intake_alarm(p_tenant UUID, p_now TIMESTAMPTZ, p_bucket1_hours INT, p_bucket2_hours INT)
RETURNS TABLE (bucket TEXT, cnt BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH untouched_intake AS (
    SELECT l.id, l.created_at
    FROM leads l
    JOIN lead_lists ll ON ll.id = l.list_id
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND ll.is_intake = true
      AND NOT EXISTS (
        SELECT 1 FROM lead_activities la
        WHERE la.lead_id = l.id
          AND la.activity_type IN ('call', 'email', 'meeting')
      )
      AND NOT EXISTS (
        SELECT 1 FROM lead_notes ln WHERE ln.lead_id = l.id
      )
  )
  SELECT
    CASE
      WHEN p_now - created_at < (p_bucket1_hours || ' hours')::INTERVAL THEN '0-' || p_bucket1_hours || 'h'
      WHEN p_now - created_at < (p_bucket2_hours || ' hours')::INTERVAL THEN p_bucket1_hours || '-' || p_bucket2_hours || 'h'
      ELSE p_bucket2_hours || 'h+'
    END AS bucket,
    COUNT(*) AS cnt
  FROM untouched_intake
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION education_idle_staff(p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (user_id UUID, user_email TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tu.user_id, u.email
  FROM tenant_users tu
  JOIN auth.users u ON u.id = tu.user_id
  WHERE tu.tenant_id = p_tenant
    AND NOT EXISTS (
      SELECT 1 FROM lead_activities la
      WHERE la.tenant_id = p_tenant
        AND la.user_id = tu.user_id
        AND la.activity_type IN ('call', 'email', 'meeting')
        AND la.created_at BETWEEN p_from AND p_to
    )
    AND NOT EXISTS (
      SELECT 1 FROM lead_notes ln
      JOIN leads l ON l.id = ln.lead_id
      WHERE l.tenant_id = p_tenant
        AND ln.user_id = tu.user_id
        AND ln.created_at BETWEEN p_from AND p_to
    );
$$;

GRANT EXECUTE ON FUNCTION education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION education_idle_staff(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('242_education_intake_and_idle.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 241: Team & Lead Performance dashboard — relay pile/touch/enrollment RPC
-- (education_consultancy, Admizz relay: TeleCaller -> Executive -> Counsellor -> App
-- Executive, under Branch Managers).
--
-- Powers two self-fetching widgets: the Relay Explorer (stage x position x person
-- drilldown) and the Branch Breakdown. One GROUP BY, pivoted client-side.
--
-- Canonical "touched" definition (binding, do not extend without updating this
-- comment + the regression test in education-relay-aggregates.test.ts):
--   lead_activities(activity_type IN ('call','email','meeting'))  UNION  lead_notes
-- Deliberately EXCLUDES sms_messages / email_messages (no user_id/sent_by column —
-- unattributable, and blast/sequence sends are automated, not human contact) and
-- lead_assignment_history (records a handoff, not contact with the lead).
--
-- "enrolled_cnt"/"tuition_value" use applications.updated_at as a proxy for "moved
-- to a won stage this window" — applications has no dedicated won-transition
-- timestamp. tuition_fee is a quoted amount, never "revenue" (see deposit_paid for
-- confirmed-collected money — out of scope here).
--
-- "cnt" (assigned pile) is a live snapshot, never window-filtered — there is no
-- stage-change history table (stage/list changes are overwritten in place).
--
-- Excludes Archived + admin-only "migration-qc" lists — this dashboard tracks the
-- active pipeline only.
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: DROP FUNCTION IF EXISTS education_relay_aggregates(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION education_relay_aggregates(p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  stage_slug     TEXT,
  stage_name     TEXT,
  position_slug  TEXT,
  position_name  TEXT,
  user_id        UUID,
  user_email     TEXT,
  branch_id      UUID,
  branch_name    TEXT,
  cnt            BIGINT,
  touched_cnt    BIGINT,
  enrolled_cnt   BIGINT,
  tuition_value  NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      l.id AS lead_id,
      l.assigned_to,
      ll.slug AS stage_slug,
      ll.name AS stage_name,
      p.slug AS position_slug,
      p.name AS position_name,
      tu.branch_id,
      br.name AS branch_name,
      u.email AS user_email
    FROM leads l
    JOIN lead_lists ll ON ll.id = l.list_id
    LEFT JOIN tenant_users tu ON tu.tenant_id = l.tenant_id AND tu.user_id = l.assigned_to
    LEFT JOIN positions p ON p.id = tu.position_id
    LEFT JOIN branches br ON br.id = tu.branch_id
    LEFT JOIN auth.users u ON u.id = l.assigned_to
    WHERE l.tenant_id = p_tenant
      AND l.deleted_at IS NULL
      AND ll.is_archive = false
      AND ll.slug <> 'migration-qc'
  ),
  touched AS (
    SELECT DISTINCT lead_id FROM (
      SELECT lead_id FROM lead_activities
      WHERE tenant_id = p_tenant
        AND activity_type IN ('call', 'email', 'meeting')
        AND created_at BETWEEN p_from AND p_to
      UNION
      SELECT ln.lead_id FROM lead_notes ln
      JOIN leads l2 ON l2.id = ln.lead_id
      WHERE l2.tenant_id = p_tenant
        AND ln.created_at BETWEEN p_from AND p_to
    ) touches
  ),
  enrolled AS (
    SELECT a.lead_id, SUM(a.tuition_fee) AS tuition
    FROM applications a
    JOIN application_stages s ON s.id = a.stage_id
    WHERE a.tenant_id = p_tenant
      AND a.deleted_at IS NULL
      AND s.terminal_type = 'won'
      AND a.updated_at BETWEEN p_from AND p_to
    GROUP BY a.lead_id
  )
  SELECT
    b.stage_slug,
    b.stage_name,
    b.position_slug,
    b.position_name,
    b.assigned_to AS user_id,
    b.user_email,
    b.branch_id,
    b.branch_name,
    COUNT(*) AS cnt,
    COUNT(t.lead_id) AS touched_cnt,
    COUNT(e.lead_id) AS enrolled_cnt,
    COALESCE(SUM(e.tuition), 0) AS tuition_value
  FROM base b
  LEFT JOIN touched t ON t.lead_id = b.lead_id
  LEFT JOIN enrolled e ON e.lead_id = b.lead_id
  GROUP BY b.stage_slug, b.stage_name, b.position_slug, b.position_name, b.assigned_to, b.user_email, b.branch_id, b.branch_name;
$$;

GRANT EXECUTE ON FUNCTION education_relay_aggregates(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('241_education_relay_aggregates.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

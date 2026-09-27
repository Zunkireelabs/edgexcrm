-- Migration 248: education_intake_alarm — return the actual intake list name+slug
--
-- Item 1 fix: migration 096_admizz_new_leads_intake.sql moved Admizz's real
-- intake list from "Pre-qualified" to "New Leads." education_intake_alarm
-- (migration 242) already correctly queries ll.is_intake = true (dynamic,
-- tenant-aware), but the widget hardcoded the display string "Pre-qualified,
-- untouched". This adds list_name/list_slug columns (same value on every row
-- — the one is_intake=true list's name/slug for this tenant) so the widget
-- can render the real label AND deep-link age-bucket badges to the Pipeline
-- widget's ?stage=<slug> (lead_lists.slug — same contract
-- education_relay_aggregates already uses for its stage_slug field).
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: CREATE OR REPLACE FUNCTION education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT)
--     RETURNS TABLE (bucket TEXT, cnt BIGINT) ... -- revert to migration 242's body.
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION education_intake_alarm(p_tenant UUID, p_now TIMESTAMPTZ, p_bucket1_hours INT, p_bucket2_hours INT)
RETURNS TABLE (bucket TEXT, cnt BIGINT, list_name TEXT, list_slug TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH untouched_intake AS (
    SELECT l.id, l.created_at, ll.name AS list_name, ll.slug AS list_slug
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
    COUNT(*) AS cnt,
    MAX(list_name) AS list_name,
    MAX(list_slug) AS list_slug
  FROM untouched_intake
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('248_education_intake_alarm_list_name.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

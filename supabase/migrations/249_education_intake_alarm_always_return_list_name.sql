-- Migration 249: education_intake_alarm — always return the intake list
-- name/slug, even when there are zero untouched leads.
--
-- Bug: migration 248 folded list_name/list_slug into the bucketed GROUP BY
-- rows (MAX(list_name) per bucket). When zero leads are untouched, there are
-- zero bucket rows to group, so the RPC returns zero rows entirely and the
-- widget's `data.buckets.find((b) => b.list_name)` finds nothing — falling
-- back to the hardcoded "Pre-qualified" string, the exact bug migration 248
-- was written to fix, reappearing whenever the alarm is in its "good" state.
--
-- Fix: decouple "what's the tenant's intake list called" from "are there any
-- bucket rows right now". Buckets are now returned as a single JSONB array
-- column; list_name/list_slug are looked up independently via a `lead_lists
-- WHERE is_intake = true` subquery. The function now always returns exactly
-- one row, whether or not any leads are untouched.
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: CREATE OR REPLACE FUNCTION education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT)
--     RETURNS TABLE (bucket TEXT, cnt BIGINT, list_name TEXT, list_slug TEXT) ... -- revert to migration 248's body.
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

-- Same reason as migration 248's DROP: this changes the RETURNS TABLE shape
-- again (248's 4 scalar columns -> buckets JSONB + list_name + list_slug),
-- which CREATE OR REPLACE rejects. Drop first.
DROP FUNCTION IF EXISTS education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT);

CREATE FUNCTION education_intake_alarm(p_tenant UUID, p_now TIMESTAMPTZ, p_bucket1_hours INT, p_bucket2_hours INT)
RETURNS TABLE (buckets JSONB, list_name TEXT, list_slug TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH intake_list AS (
    SELECT ll.name, ll.slug
    FROM lead_lists ll
    WHERE ll.tenant_id = p_tenant
      AND ll.is_intake = true
    LIMIT 1
  ),
  untouched_intake AS (
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
  ),
  bucketed AS (
    SELECT
      CASE
        WHEN p_now - created_at < (p_bucket1_hours || ' hours')::INTERVAL THEN '0-' || p_bucket1_hours || 'h'
        WHEN p_now - created_at < (p_bucket2_hours || ' hours')::INTERVAL THEN p_bucket1_hours || '-' || p_bucket2_hours || 'h'
        ELSE p_bucket2_hours || 'h+'
      END AS bucket,
      COUNT(*) AS cnt
    FROM untouched_intake
    GROUP BY 1
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('bucket', bucket, 'cnt', cnt)) FROM bucketed), '[]'::jsonb) AS buckets,
    (SELECT name FROM intake_list) AS list_name,
    (SELECT slug FROM intake_list) AS list_slug;
$$;

GRANT EXECUTE ON FUNCTION education_intake_alarm(UUID, TIMESTAMPTZ, INT, INT) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('249_education_intake_alarm_always_return_list_name.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 243: Team & Lead Performance dashboard — Leakage Funnel RPC
-- (education_consultancy). Per stage, how many leads that were there in the
-- window got archived out without ever advancing, broken down by archive_reason.
--
-- Uses leads.archived_from_list_id + archived_at (migration 127) — forward-only:
-- leads archived before 2026-07-07 have these columns NULL and are excluded here,
-- same caveat as that migration. Fine for windowed ("this window") reporting.
--
--   Expected before/after row counts: 0 rows touched (function definition only).
--   Rollback: DROP FUNCTION IF EXISTS education_leakage_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION education_leakage_funnel(p_tenant UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (stage_slug TEXT, stage_name TEXT, archive_reason TEXT, cnt BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ll.slug AS stage_slug,
    ll.name AS stage_name,
    COALESCE(NULLIF(l.archive_reason, ''), 'Other') AS archive_reason,
    COUNT(*) AS cnt
  FROM leads l
  JOIN lead_lists ll ON ll.id = l.archived_from_list_id
  WHERE l.tenant_id = p_tenant
    AND l.archived_at BETWEEN p_from AND p_to
  GROUP BY ll.slug, ll.name, COALESCE(NULLIF(l.archive_reason, ''), 'Other');
$$;

GRANT EXECUTE ON FUNCTION education_leakage_funnel(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('243_education_leakage_funnel.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 217: Form Submissions surface — index + counts RPC
--
-- Supports the new per-form Submissions tab (read-only lens over lead_submissions,
-- migration 033). No new writes, no change to any ingestion path.
--
-- 1. Index — no existing index covers a per-form, newest-first query (existing ones
--    are (lead_id, created_at), (tenant_id, normalized_email), (tenant_id, created_at)).
-- 2. form_submission_counts(p_tenant_id) RPC — one round trip for the Forms list
--    instead of N per-form count queries. Takes a tenant id as a parameter, so it is
--    REVOKEd from anon/authenticated and callable only by the service client (which
--    always supplies auth.tenantId) — mirrors the posture of migration 195.
--
-- Additive only. 0 existing rows touched.
--   Expected before/after row counts: 0 rows touched (index + function only).
--   Rollback:
--     DROP FUNCTION IF EXISTS form_submission_counts(UUID);
--     DROP INDEX IF EXISTS idx_lead_submissions_form_created;
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_lead_submissions_form_created
  ON lead_submissions (tenant_id, form_config_id, created_at DESC)
  WHERE form_config_id IS NOT NULL;

CREATE OR REPLACE FUNCTION form_submission_counts(p_tenant_id UUID)
RETURNS TABLE (form_config_id UUID, total BIGINT, last_30d BIGINT)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT form_config_id,
         COUNT(*),
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')
  FROM lead_submissions
  WHERE tenant_id = p_tenant_id AND form_config_id IS NOT NULL
  GROUP BY form_config_id;
$$;

REVOKE ALL ON FUNCTION form_submission_counts(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION form_submission_counts(UUID) TO service_role;

INSERT INTO public.schema_migrations (version) VALUES ('217_form_submission_counts.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 131: public share token for status reports (repurposes existing
-- dead is_client_visible boolean as the enable gate — no second flag)
--
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: project_status_reports: 0 rows touched (column add only).
--   Rollback: DROP INDEX IF EXISTS uq_project_status_reports_public_token; ALTER TABLE project_status_reports DROP COLUMN IF EXISTS public_token;
--   Applied: stage HELD / prod HELD (local only per brief).

BEGIN;

ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_status_reports_public_token
  ON project_status_reports(public_token) WHERE public_token IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('131_status_report_public_share.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

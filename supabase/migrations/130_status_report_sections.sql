-- Migration 130: add structured sections to project_status_reports
--
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: project_status_reports: 0 rows touched (column add only).
--   Rollback: ALTER TABLE project_status_reports DROP COLUMN IF EXISTS accomplishments, DROP COLUMN IF EXISTS in_progress, DROP COLUMN IF EXISTS risks, DROP COLUMN IF EXISTS asks, DROP COLUMN IF EXISTS client_message;
--   Applied: stage HELD / prod HELD (local only per brief).

BEGIN;

ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS accomplishments TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS in_progress TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS risks TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS asks TEXT;
ALTER TABLE project_status_reports ADD COLUMN IF NOT EXISTS client_message TEXT;

INSERT INTO public.schema_migrations (version) VALUES ('130_status_report_sections.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

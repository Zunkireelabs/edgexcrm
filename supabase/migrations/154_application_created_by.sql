-- Migration 154: Application created_by
--
-- Retires the per-application "Application Executive" assignee concept.
-- Adds applications.created_by so the UI can show "Created by ___" instead
-- of an editable assigned_to dropdown. Backfills from the earliest
-- application.created audit_logs row per application; apps with no matching
-- audit row are left NULL (UI falls back to "System"/"—").
-- applications.assigned_to is NOT dropped or touched by this migration.
-- Additive only. Wrap in BEGIN/COMMIT. Include:
--   Expected before/after row counts: applications: apps_with_creator goes
--   from 0 -> N (N = count of applications with a matching
--   application.created audit_logs row); apps_total unchanged.
--   Rollback: ALTER TABLE applications DROP COLUMN IF EXISTS created_by;
--   Applied: stage 2026-07-14 / prod HELD (promotion pass).

BEGIN;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill: earliest application.created audit log's user_id per application.
-- Guarded by "created_by IS NULL" so a re-run is a no-op.
WITH first_created AS (
  SELECT DISTINCT ON (entity_id) entity_id, user_id
  FROM audit_logs
  WHERE entity_type = 'application' AND action = 'application.created'
  ORDER BY entity_id, created_at ASC
)
UPDATE applications a
SET created_by = fc.user_id
FROM first_created fc
WHERE fc.entity_id = a.id
  AND a.created_by IS NULL
  AND fc.user_id IS NOT NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('154_application_created_by.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

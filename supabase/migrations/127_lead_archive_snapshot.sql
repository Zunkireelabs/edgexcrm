-- Migration 127: capture who/when/where a lead was archived.
-- The archive view needs to show, per lead, the stage + status it held at archive
-- time and who archived it. Live stage_id/status are unreliable after archiving
-- (the single-lead move clears them; bulk keeps them), so snapshot into dedicated
-- columns at archive time. All additive + nullable — inert for existing rows.
--   archived_by         — user who moved the lead into an archive list
--   archived_at         — when it was archived
--   archived_from_list_id — the list (stage) it was in just before archiving
--   archived_from_status  — the pipeline status slug it held just before archiving
-- Forward-only: existing archived leads stay NULL (no reliable history to backfill).

BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS archived_by           UUID REFERENCES auth.users(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_from_list_id UUID REFERENCES lead_lists(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_from_status  TEXT;

COMMIT;

-- Rollback:
-- ALTER TABLE leads
--   DROP COLUMN IF EXISTS archived_by,
--   DROP COLUMN IF EXISTS archived_at,
--   DROP COLUMN IF EXISTS archived_from_list_id,
--   DROP COLUMN IF EXISTS archived_from_status;

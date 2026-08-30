-- Migration 219: author + timestamp for the applications.notes field
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: applications — 2 new nullable columns;
--     backfill touches only rows with a non-empty notes value
--     (UPDATE <n>, where n = COUNT(*) FROM applications WHERE notes <> '').
--   Rollback:
--     ALTER TABLE applications DROP COLUMN IF EXISTS notes_updated_by;
--     ALTER TABLE applications DROP COLUMN IF EXISTS notes_updated_at;
--
-- Context: the lead Activity timeline (activities-panel.tsx) shows every row as
-- "time · actor" EXCEPT "Application note", which had no author to show —
-- applications.notes is a single mutable text column with no edit attribution
-- (created_by, migration 154, is the application creator, not the note author).
-- These two columns are stamped by the POST/PATCH /api/v1/applications routes
-- whenever `notes` is written, and the timeline resolves the actor from
-- notes_updated_by (falling back to created_by for pre-existing rows).

BEGIN;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS notes_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS notes_updated_at TIMESTAMPTZ;

-- Best-effort backfill for notes written before this migration: we can't know
-- who last edited the free-text field, so attribute it to the application
-- creator at the application's last-updated time. Guarded so a re-run is a
-- no-op (only fills rows that still have both columns NULL and a real note).
UPDATE applications
SET notes_updated_by = created_by,
    notes_updated_at = COALESCE(updated_at, created_at)
WHERE notes IS NOT NULL
  AND btrim(notes) <> ''
  AND notes_updated_by IS NULL
  AND notes_updated_at IS NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('219_application_notes_author.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

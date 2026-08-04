-- Migration 198: add applications.stage_changed_at — tracks stage moves only,
-- separate from updated_at (which bumps on every field edit). Mirrors migration
-- 196 (leads.stage_changed_at).
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: applications: N rows -> N rows (0 rows added/removed,
--   1 new column, all existing rows backfilled from updated_at).
--   Rollback: ALTER TABLE applications DROP COLUMN IF EXISTS stage_changed_at;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'applications' AND column_name = 'stage_changed_at'
  ) THEN
    ALTER TABLE applications ADD COLUMN stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
    -- Backfill: best guess is current updated_at, since we have no history of past stage moves.
    -- trigger_applications_updated_at fires on ANY UPDATE and unconditionally sets NEW.updated_at =
    -- NOW() — must be disabled for this statement or the backfill itself clobbers every row's
    -- real updated_at with the migration's run time.
    ALTER TABLE applications DISABLE TRIGGER trigger_applications_updated_at;
    UPDATE applications SET stage_changed_at = updated_at;
    ALTER TABLE applications ENABLE TRIGGER trigger_applications_updated_at;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('198_applications_stage_changed_at.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

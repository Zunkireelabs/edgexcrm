-- Migration 196: add leads.stage_changed_at — tracks stage/status moves only,
-- separate from updated_at (which bumps on every field edit).
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: leads: N rows -> N rows (0 rows added/removed,
--   1 new column, all existing rows backfilled from updated_at).
--   Rollback: ALTER TABLE leads DROP COLUMN IF EXISTS stage_changed_at;
--   Applied: stage 2026-08-03 / prod HELD.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'stage_changed_at'
  ) THEN
    ALTER TABLE leads ADD COLUMN stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
    -- Backfill: best guess is current updated_at, since we have no history of past stage moves.
    -- trigger_leads_updated_at fires on ANY UPDATE and unconditionally sets NEW.updated_at =
    -- NOW() — must be disabled for this statement or the backfill itself clobbers every row's
    -- real updated_at with the migration's run time (shipped this bug on stage 2026-08-03,
    -- lost the true last-edited timestamp for all leads; do not repeat on prod).
    ALTER TABLE leads DISABLE TRIGGER trigger_leads_updated_at;
    UPDATE leads SET stage_changed_at = updated_at;
    ALTER TABLE leads ENABLE TRIGGER trigger_leads_updated_at;
  END IF;
END $$;

INSERT INTO public.schema_migrations (version) VALUES ('196_leads_stage_changed_at.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 177: outreach draft-due bell — fire-once stamp on sequence_step_drafts
--
-- Additive column + partial index so the reminders cron can find due, unsent,
-- un-notified drafts cheaply. Mirrors lead_checklists.reminded_at.
--
-- Expected before/after row counts: 0 rows touched (new nullable column, default NULL).
-- Rollback:
--   DROP INDEX IF EXISTS idx_ssd_due_unnotified;
--   ALTER TABLE public.sequence_step_drafts DROP COLUMN IF EXISTS notified_at;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.sequence_step_drafts
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ssd_due_unnotified
  ON public.sequence_step_drafts (due_at)
  WHERE status = 'pending' AND notified_at IS NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('177_outreach_draft_due_notified_at.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

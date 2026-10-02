-- Migration 256: Outreach "Schedule send" — let a rep pick a date/time for one sequence draft.
--
-- Additive only. Adds three nullable columns to sequence_step_drafts:
--   scheduled_send_at  when EdgeX should send this draft (UTC). NULL = not scheduled.
--   scheduled_by       the user who scheduled it (credited on the lead timeline when it fires).
--   scheduled_error    why a scheduled send did NOT go out (set when the runner clears a failed schedule).
-- plus a partial index so the in-app schedule runner can find due scheduled drafts cheaply.
-- No RLS change: the table already has tenant RLS and the new columns inherit it.
--
-- Expected before/after row counts: 0 rows touched (new nullable columns, default NULL).
-- Rollback:
--   DROP INDEX IF EXISTS idx_ssd_scheduled_due;
--   ALTER TABLE public.sequence_step_drafts
--     DROP COLUMN IF EXISTS scheduled_error,
--     DROP COLUMN IF EXISTS scheduled_by,
--     DROP COLUMN IF EXISTS scheduled_send_at;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.sequence_step_drafts
  ADD COLUMN IF NOT EXISTS scheduled_send_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_error TEXT;

CREATE INDEX IF NOT EXISTS idx_ssd_scheduled_due
  ON public.sequence_step_drafts (scheduled_send_at)
  WHERE status = 'pending' AND scheduled_send_at IS NOT NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('256_sequence_drafts_scheduled_send.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

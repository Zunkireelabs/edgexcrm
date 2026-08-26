-- Migration 216: Outreach Phase 2 — auto-send seam on email_sequences
--
-- Additive only. Adds auto_send to email_sequences (per-sequence, default
-- false — it_agency's existing sequences keep the manual-copy model exactly
-- as-is) and email_message_id to sequence_step_drafts so the cadence
-- timeline can show real delivery/bounce status for auto-sent steps.
--
-- Expected before/after row counts: 0 rows touched (new columns, defaults
-- applied on read, not a rewrite).
-- Rollback:
--   ALTER TABLE public.sequence_step_drafts DROP COLUMN IF EXISTS email_message_id;
--   ALTER TABLE public.email_sequences DROP COLUMN IF EXISTS auto_send;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS auto_send BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sequence_step_drafts
  ADD COLUMN IF NOT EXISTS email_message_id UUID REFERENCES public.email_messages(id) ON DELETE SET NULL;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('216_email_sequences_auto_send.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

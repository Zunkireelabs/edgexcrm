-- Migration 264: per-step send time (Outreach).
--
-- Why: a sequence's send window (migration 260) gives every step the same clock time. Each email in a sequence can now
-- have its own time of day: email 1 at 10:00, email 2 at 15:00, email 3 at 09:00. The days still come from the
-- sequence's window (a step that lands on a day outside it moves to the next allowed day, at the step's time).
--
-- email_sequence_steps.send_time is "HH:MM" (24 h, local time in the lead's / office's zone per the window) or NULL.
-- NULL = use the sequence window's time = today's behaviour exactly, so every existing step is unchanged. Validated in
-- the API (lib/send-window.ts::validateStepSendTime); the database checks the shape too. It is read when a step's draft
-- is CREATED; drafts already created keep their due_at.
--
-- Additive only: one nullable column, no backfill.
--   Expected before/after row counts: email_sequence_steps: 0 rows touched.
--   Rollback: ALTER TABLE public.email_sequence_steps DROP COLUMN IF EXISTS send_time;

BEGIN;

ALTER TABLE public.email_sequence_steps
  ADD COLUMN IF NOT EXISTS send_time TEXT
    CHECK (send_time IS NULL OR send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

INSERT INTO public.schema_migrations (version) VALUES ('264_sequence_step_send_time.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

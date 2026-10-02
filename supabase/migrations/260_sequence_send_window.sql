-- Migration 260: send window on a sequence (Outreach Phase 3).
--
-- Why: a sequence step was due `delay_days * 24h` after the previous one — the same clock time as the last email,
-- on any day (a Saturday night included), in nobody's timezone, and for a bulk enroll every lead's next step at the
-- very same moment. email_sequences.send_window says WHEN a step may go out:
--   { "time": "10:00", "days": [1,2,3,4,5], "timezone_mode": "lead"|"office", "spread_minutes": 120 }
--   time            local clock time the window opens (HH:MM)
--   days            allowed weekdays, 0 = Sunday .. 6 = Saturday (same convention as tenants.weekend_days)
--   timezone_mode   "lead": the lead's timezone from their country, falling back to tenants.timezone; "office": tenants.timezone
--   spread_minutes  the window is [time, time + spread); each lead gets a stable minute in it (0 = exactly at time)
-- The shape is validated in the API (outreach/lib/send-window.ts::validateSendWindow); the database only insists it
-- is a JSON object so a stray scalar can't be stored.
--
-- NULL = no window = today's behaviour, exactly. Every existing sequence is NULL, so NOTHING changes for them until
-- an admin turns the window on in the sequence editor. It is read when a step's draft is CREATED (engine.ts
-- createDraftForStep -> sequence_step_drafts.due_at); drafts already created keep the due_at they have.
--
-- Additive only: one nullable column, no backfill.
--   Expected before/after row counts: email_sequences: 0 rows touched (ADD COLUMN, nullable, no default).
--   Rollback: ALTER TABLE public.email_sequences DROP COLUMN IF EXISTS send_window;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS send_window JSONB
    CHECK (send_window IS NULL OR jsonb_typeof(send_window) = 'object');

INSERT INTO public.schema_migrations (version) VALUES ('260_sequence_send_window.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

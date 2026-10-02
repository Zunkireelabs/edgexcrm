-- Migration 257: sequences stop (pause by default) when the lead replies.
--
-- Why: nothing ended or paused a sequence enrollment automatically. A lead who answered Step 1
-- ("yes, call me") still received Steps 2 and 3 unless a rep noticed and paused by hand — fine for one lead,
-- impossible at hundreds. The inbound-email processor now calls stopEnrollmentsOnReply() for a genuine
-- (non-auto) reply, and that function reads these columns.
--
-- email_sequences.on_reply: what a reply does to a lead's ACTIVE enrollment in this sequence.
--   'pause'    (default) freeze it; a rep resumes or unenrolls with one click. Nothing sends while paused.
--   'end'      unenroll it (same end state as the manual "unenroll" button).
--   'continue' ignore replies (e.g. a newsletter-style series).
-- sequence_enrollments.stop_reason / stopped_at: why and when the system stopped an enrollment ('replied').
--   NULL for enrollments paused or ended by a person. Cleared again on resume.
--
-- Additive only: three new columns, no backfill statement. Existing sequences read 'pause' through the column
-- default, i.e. reply-stop is ON for every existing sequence — that is the point of the safety fix; a sequence
-- that should keep going can be set to 'continue' in the editor.
--   Expected before/after row counts: email_sequences / sequence_enrollments: 0 rows touched
--   (ADD COLUMN with a constant default is metadata-only on current Postgres).
--   Rollback: ALTER TABLE public.email_sequences DROP COLUMN IF EXISTS on_reply;
--             ALTER TABLE public.sequence_enrollments DROP COLUMN IF EXISTS stop_reason, DROP COLUMN IF EXISTS stopped_at;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.email_sequences
  ADD COLUMN IF NOT EXISTS on_reply TEXT NOT NULL DEFAULT 'pause'
    CHECK (on_reply IN ('pause', 'end', 'continue'));

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS stop_reason TEXT CHECK (stop_reason IN ('replied')),
  ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;

INSERT INTO public.schema_migrations (version) VALUES ('257_sequence_reply_stop.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

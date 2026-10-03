-- Migration 262: a sequence ends when the lead's address lands on the do-not-contact list (Outreach Phase 4).
--
-- Why: an unsubscribe, a hard bounce or a spam complaint adds the address to email_suppressions, and the send path then
-- refuses to email it — but the lead's sequence enrollment stayed ACTIVE. Every remaining step failed (or was left
-- pending), a sequence kept "running" for someone who can never be emailed, and the lead stayed locked out of any other
-- sequence by the one-running-enrollment rule. suppressEmail() now ends their running enrollments, recording why.
--
-- sequence_enrollments.stop_reason (mig 257, widened in 259) gains a third value, 'suppressed'. Widening a CHECK is safe:
-- every existing row (NULL, 'replied', 'sequence_paused') still satisfies it.
--
-- Additive only: a constraint swap, no row rewritten.
--   Expected before/after row counts: sequence_enrollments: 0 rows touched.
--   Rollback: ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
--             ALTER TABLE public.sequence_enrollments ADD CONSTRAINT sequence_enrollments_stop_reason_check
--               CHECK (stop_reason IN ('replied', 'sequence_paused'));
--             (only safe once no row holds 'suppressed')
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

ALTER TABLE public.sequence_enrollments DROP CONSTRAINT IF EXISTS sequence_enrollments_stop_reason_check;
ALTER TABLE public.sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_stop_reason_check CHECK (stop_reason IN ('replied', 'sequence_paused', 'suppressed'));

INSERT INTO public.schema_migrations (version) VALUES ('262_enrollment_stop_reason_suppressed.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

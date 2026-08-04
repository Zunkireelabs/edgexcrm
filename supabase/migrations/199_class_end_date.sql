-- Migration 199: Class end_date (education_consultancy, classes)
--
-- Adds an optional end_date to classes so a scheduled job
-- (src/lib/inngest/functions/class-completion-sweep.ts) can auto-flip active
-- enrollments to status='completed' once the class has run its course,
-- instead of requiring a manual status change per student.
--
--   Expected before/after row counts: classes row count unchanged
--     (existing rows default to end_date NULL — no auto-complete until set).
--   Rollback: ALTER TABLE classes DROP COLUMN end_date;

BEGIN;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS end_date DATE;

INSERT INTO public.schema_migrations (version) VALUES ('199_class_end_date.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

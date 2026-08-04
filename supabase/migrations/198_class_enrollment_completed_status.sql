-- Migration 198: Add 'completed' status to class_enrollments
-- (education_consultancy) — third status alongside active/inactive, meaning the
-- student finished the actual class (course over), distinct from inactive
-- (dropped/paused early).
--
--   Expected before/after row counts: class_enrollments row count unchanged.
--   Rollback: ALTER TABLE class_enrollments DROP CONSTRAINT class_enrollments_status_check;
--             ALTER TABLE class_enrollments ADD CONSTRAINT class_enrollments_status_check
--               CHECK (status IN ('active', 'inactive'));
--             (only safe if no row currently has status='completed')

BEGIN;

ALTER TABLE class_enrollments DROP CONSTRAINT IF EXISTS class_enrollments_status_check;
ALTER TABLE class_enrollments ADD CONSTRAINT class_enrollments_status_check
  CHECK (status IN ('active', 'inactive', 'completed'));

INSERT INTO public.schema_migrations (version) VALUES ('198_class_enrollment_completed_status.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

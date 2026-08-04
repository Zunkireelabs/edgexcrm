-- Migration 197: Demo/Actual enrollment tracking + Active/Inactive status
-- (education_consultancy, class_enrollments)
--
-- A student can now hold two enrollment rows per class: one enrollment_type='demo'
-- (2-3 day trial) and one enrollment_type='actual' (the real class). Widens the
-- existing one-enrollment-per-(lead,class) uniqueness to one-per-(lead,class,type)
-- so both can coexist. Adds a status flag (active/inactive) independent of fee_paid.
--
--   Expected before/after row counts: class_enrollments row count unchanged
--     (existing rows default to enrollment_type='actual', status='active').
--   Rollback: ALTER TABLE class_enrollments DROP COLUMN enrollment_type, DROP COLUMN status;
--             DROP INDEX IF EXISTS uniq_class_enrollment_active;
--             CREATE UNIQUE INDEX uniq_class_enrollment_active ON class_enrollments
--               (tenant_id, lead_id, class_id) WHERE deleted_at IS NULL;

BEGIN;

ALTER TABLE class_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_type TEXT NOT NULL DEFAULT 'actual'
    CHECK (enrollment_type IN ('demo', 'actual')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));

DROP INDEX IF EXISTS uniq_class_enrollment_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_class_enrollment_active
  ON class_enrollments (tenant_id, lead_id, class_id, enrollment_type)
  WHERE deleted_at IS NULL;

INSERT INTO public.schema_migrations (version) VALUES ('197_class_enrollment_demo_status.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

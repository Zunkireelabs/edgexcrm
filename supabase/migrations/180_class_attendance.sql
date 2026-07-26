-- Migration 180: Class Attendance (education_consultancy)
-- Two tables: class_attendance (per-enrollment, per-date present/absent) +
-- class_attendance_markers (allowlist of non-admin users permitted to mark).
-- Additive + idempotent. Seeds the 3 launch markers for the Admizz tenant.
--
--   Expected before/after row counts: class_attendance 0 -> 0,
--     class_attendance_markers 0 -> 3 (Admizz tenant seed).
--   Rollback: DROP TABLE IF EXISTS class_attendance;
--             DROP TABLE IF EXISTS class_attendance_markers;
--   Applied: stage 2026-07-26 / prod HELD.

BEGIN;

-- ── 1. class_attendance ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS class_attendance (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id UUID NOT NULL REFERENCES class_enrollments(id) ON DELETE CASCADE,
  session_date  DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('present', 'absent')),
  marked_by     UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_class_attendance_tenant_enrollment
  ON class_attendance (tenant_id, enrollment_id);

CREATE INDEX IF NOT EXISTS idx_class_attendance_tenant_date
  ON class_attendance (tenant_id, session_date);

ALTER TABLE class_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "class_attendance_select" ON class_attendance;
CREATE POLICY "class_attendance_select" ON class_attendance
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "class_attendance_insert" ON class_attendance;
CREATE POLICY "class_attendance_insert" ON class_attendance
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "class_attendance_update" ON class_attendance;
CREATE POLICY "class_attendance_update" ON class_attendance
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "class_attendance_delete" ON class_attendance;
CREATE POLICY "class_attendance_delete" ON class_attendance
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_class_attendance_updated_at ON class_attendance;
CREATE TRIGGER trigger_class_attendance_updated_at
  BEFORE UPDATE ON class_attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. class_attendance_markers (allowlist) ─────────────────────────────────
-- App-layer routes are the real gate (canMarkClassAttendance uses the service
-- client), but RLS is included as defense-in-depth per the tenant-isolation rule.

CREATE TABLE IF NOT EXISTS class_attendance_markers (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE class_attendance_markers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "class_attendance_markers_select" ON class_attendance_markers;
CREATE POLICY "class_attendance_markers_select" ON class_attendance_markers
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "class_attendance_markers_insert" ON class_attendance_markers;
CREATE POLICY "class_attendance_markers_insert" ON class_attendance_markers
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "class_attendance_markers_delete" ON class_attendance_markers;
CREATE POLICY "class_attendance_markers_delete" ON class_attendance_markers
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- ── 3. Seed launch markers (Admizz tenant, education_consultancy) ──────────
-- Purnima, Kamana, Pratima — see docs/superpowers/specs/2026-07-26-class-attendance-design.md
--
-- Pratima's auth.users row (cb4f8a10-847b-4e7e-8b99-92c54d16947b) only exists on
-- prod — her account postdates the 2026-06-21 stage clone, so stage's auth.users
-- doesn't have it and the FK would fail there. Seed the two that exist everywhere
-- here; add Pratima with the one-line INSERT below when this migration reaches
-- prod (both DBs then converge on all 3 markers):
--   INSERT INTO class_attendance_markers (tenant_id, user_id)
--   VALUES ('febeb37c-521c-4f29-adbb-0195b2eede88', 'cb4f8a10-847b-4e7e-8b99-92c54d16947b')
--   ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO class_attendance_markers (tenant_id, user_id)
VALUES
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'ad32e374-b421-45f2-a32a-b0ef003e4dba'), -- Purnima
  ('febeb37c-521c-4f29-adbb-0195b2eede88', 'e6e2ad98-2838-4202-a67e-da71ae68227d')  -- Kamana
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO public.schema_migrations (version) VALUES ('180_class_attendance.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

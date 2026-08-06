-- Migration 200: Class Managers (education_consultancy)
-- Replaces the two hardcoded classes-access mechanisms (class_attendance_markers
-- allowlist + CLASS_ENROLL_POSITIONS position-slug list in src/lib/api/permissions.ts)
-- with a single admin-managed, per-user, per-capability grant table.
--
-- Additive + idempotent. Two backfills into the new table:
--   1. class_attendance_markers rows -> mark_attendance=true, view_roster=true,
--      enroll_students=false (existing markers keep exactly what they had — no
--      new enroll grant, per explicit product decision).
--   2. Every education_consultancy tenant_user whose position slug was in the
--      old CLASS_ENROLL_POSITIONS set (branch-manager, lead-executive,
--      counselor, application-executive) -> enroll_students=true, preserving
--      whatever mark_attendance/view_roster they already have (does not
--      downgrade backfill #1). Without this, replacing the position-slug check
--      with class_managers would silently revoke enroll access from everyone
--      who held it by position, which is a real regression, not an intended
--      tightening — the product decision was "admin manages it going forward",
--      not "everyone's existing access is revoked on cutover".
-- class_attendance_markers is left in place; it becomes dead once the app-code
-- cutover (separate change) ships reads/writes against class_managers instead.
-- Do not drop it here.
--
--   Expected before/after row counts: class_managers 0 -> N
--     (N = markers rows + position-holder rows, deduped by (tenant_id,user_id)).
--   Rollback: DROP TABLE IF EXISTS class_managers;
--   Applied: stage TBD / prod TBD.

BEGIN;

CREATE TABLE IF NOT EXISTS class_managers (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enroll_students BOOLEAN NOT NULL DEFAULT false,
  mark_attendance BOOLEAN NOT NULL DEFAULT false,
  view_roster     BOOLEAN NOT NULL DEFAULT false,
  granted_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE class_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "class_managers_select" ON class_managers;
CREATE POLICY "class_managers_select" ON class_managers
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "class_managers_insert" ON class_managers;
CREATE POLICY "class_managers_insert" ON class_managers
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "class_managers_update" ON class_managers;
CREATE POLICY "class_managers_update" ON class_managers
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "class_managers_delete" ON class_managers;
CREATE POLICY "class_managers_delete" ON class_managers
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_class_managers_updated_at ON class_managers;
CREATE TRIGGER trigger_class_managers_updated_at
  BEFORE UPDATE ON class_managers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Backfill 1: class_attendance_markers ────────────────────────────────────
INSERT INTO class_managers (tenant_id, user_id, enroll_students, mark_attendance, view_roster)
SELECT tenant_id, user_id, false, true, true
FROM class_attendance_markers
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET mark_attendance = true, view_roster = true;

-- ── Backfill 2: old position-slug enroll access (parity with pre-cutover behavior) ──
INSERT INTO class_managers (tenant_id, user_id, enroll_students, mark_attendance, view_roster)
SELECT tu.tenant_id, tu.user_id, true, false, false
FROM tenant_users tu
JOIN positions p ON p.id = tu.position_id
JOIN tenants t ON t.id = tu.tenant_id
WHERE t.industry_id = 'education_consultancy'
  AND p.slug IN ('branch-manager', 'lead-executive', 'counselor', 'application-executive')
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET enroll_students = true;

INSERT INTO public.schema_migrations (version) VALUES ('200_class_managers.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

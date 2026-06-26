-- Migration 065: Classes feature (education_consultancy only)
-- Two tables: classes (catalog) + class_enrollments (per-lead)
-- Additive + idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- Scope: education_consultancy. Other industries untouched.

BEGIN;

-- ── 1. classes (catalog) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS classes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  default_fee  NUMERIC(14,2),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_classes_tenant ON classes (tenant_id);

ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "classes_select" ON classes
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "classes_insert" ON classes
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "classes_update" ON classes
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "classes_delete" ON classes
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_classes_updated_at
  BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. class_enrollments ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS class_enrollments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  fee_paid     BOOLEAN NOT NULL DEFAULT false,
  fee_amount   NUMERIC(14,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

-- One active enrollment per (lead, class)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_class_enrollment_active
  ON class_enrollments (tenant_id, lead_id, class_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_class_enroll_tenant_class
  ON class_enrollments (tenant_id, class_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_class_enroll_tenant_lead
  ON class_enrollments (tenant_id, lead_id)
  WHERE deleted_at IS NULL;

ALTER TABLE class_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "class_enrollments_select" ON class_enrollments
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "class_enrollments_insert" ON class_enrollments
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "class_enrollments_update" ON class_enrollments
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "class_enrollments_delete" ON class_enrollments
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_class_enrollments_updated_at
  BEFORE UPDATE ON class_enrollments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. canManageClasses permission seed ───────────────────────────────────────
-- Mirrors 058_application_manage_permission.sql shape.
-- Only touches system positions for education_consultancy tenants.

UPDATE positions
SET permissions = jsonb_set(permissions, '{canManageClasses}', 'true'::jsonb, true)
WHERE is_system = true
  AND slug IN ('counselor', 'branch-manager')
  AND tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'education_consultancy');

COMMIT;

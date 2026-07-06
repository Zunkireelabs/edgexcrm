-- Migration 112: HRMS Phase 1 — departments + employee_profiles
-- Additive only. No writes to tenant_users or any existing table.
-- Employee identity stays tenant_users; employee_profiles is a 1:1 extension.
-- Not applied by Sonnet — Opus applies to stage after review (see CLAUDE.md migration workflow).

BEGIN;

-- 1. departments -------------------------------------------------------------
-- Functional grouping, independent of the org_layers RBAC hierarchy.
CREATE TABLE IF NOT EXISTS departments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  lead_tenant_user_id    UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select" ON departments
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "departments_insert" ON departments
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "departments_update" ON departments
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "departments_delete" ON departments
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 2. employee_profiles --------------------------------------------------------
-- 1:1 extension of tenant_users. No parallel "employees" identity table.
-- Pay stays on tenant_users.default_hourly_rate — deliberately not duplicated here.
CREATE TABLE IF NOT EXISTS employee_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_user_id           UUID NOT NULL UNIQUE REFERENCES tenant_users(id) ON DELETE CASCADE,
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employment_type          TEXT CHECK (employment_type IN ('full_time','part_time','contractor','intern')),
  employment_status        TEXT NOT NULL DEFAULT 'active'
                              CHECK (employment_status IN ('active','on_leave','notice','terminated')),
  billable                 BOOLEAN NOT NULL DEFAULT TRUE,
  weekly_capacity_hours    NUMERIC NOT NULL DEFAULT 40,
  job_title                TEXT,
  hire_date                DATE,
  date_of_birth            DATE,
  phone                    TEXT,
  address                  TEXT,
  photo_url                TEXT, -- storage path in a private bucket, never a public URL
  emergency_contact        JSONB,
  department_id            UUID REFERENCES departments(id) ON DELETE SET NULL,
  manager_tenant_user_id   UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_tenant ON employee_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_department ON employee_profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_manager ON employee_profiles(manager_tenant_user_id);

ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;

-- RLS stays tenant-coarse (matches every other table in this schema). Self /
-- manager scoping (an employee reads only their own row unless canManageHR or
-- a manager of the row) is enforced in the API layer — see Chunk C.
CREATE POLICY "employee_profiles_select" ON employee_profiles
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "employee_profiles_insert" ON employee_profiles
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "employee_profiles_update" ON employee_profiles
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "employee_profiles_delete" ON employee_profiles
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_employee_profiles_updated_at
  BEFORE UPDATE ON employee_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Additive-only: 2 new tables, 0 rows touched on any existing table.
-- Expected before/after on existing tables: unchanged (tenants, tenant_users row counts identical).
-- departments: 0 -> 0 rows (empty until admins create departments).
-- employee_profiles: 0 -> 0 rows (empty until admins/HR create profiles).

COMMIT;

-- Migration 114: HRMS Phase 1 — project_allocations (it_agency Resourcing edge)
-- Additive only. Plugs into the existing projects / time_entries spine.
-- Not applied by Sonnet — Opus applies to stage after review (see CLAUDE.md migration workflow).

BEGIN;

CREATE TABLE IF NOT EXISTS project_allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_user_id    UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  hours_per_week    NUMERIC NOT NULL,
  role_on_project   TEXT,
  start_date        DATE,
  end_date          DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- hours_per_week is stored (not a %) so it stays valid if weekly_capacity_hours
-- changes later; the UI derives % = hours_per_week / employee_profiles.weekly_capacity_hours.

CREATE INDEX IF NOT EXISTS idx_project_allocations_tenant_project ON project_allocations(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_allocations_tenant_user ON project_allocations(tenant_id, tenant_user_id);

ALTER TABLE project_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_allocations_select" ON project_allocations
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "project_allocations_insert" ON project_allocations
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "project_allocations_update" ON project_allocations
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "project_allocations_delete" ON project_allocations
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- Additive-only: 1 new table, no seed data, no existing table rows modified.
-- Expected before/after: project_allocations 0 -> 0 rows (populated by admins/HR via the
-- Resourcing board afterwards).

COMMIT;

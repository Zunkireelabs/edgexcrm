-- Migration 020: Time Tracking
-- Adds accounts, projects, tasks, time_entries tables for the IT-agency time tracking feature.
-- Also extends tenant_users (default_hourly_rate) and leads (account_id).

-- ============================================================
-- 1. accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  primary_contact_email TEXT,
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select" ON accounts
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "accounts_insert" ON accounts
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "accounts_update" ON accounts
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "accounts_delete" ON accounts
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_active
  ON accounts (tenant_id) WHERE is_active = TRUE;

-- ============================================================
-- 2. projects
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('planning','active','on_hold','done','cancelled')),
  default_rate  NUMERIC(10,2),
  is_billable   BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_select" ON projects
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "projects_insert" ON projects
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "projects_update" ON projects
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "projects_delete" ON projects
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_projects_tenant_account
  ON projects (tenant_id, account_id);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_active
  ON projects (tenant_id) WHERE status = 'active';

-- ============================================================
-- 3. tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'todo'
                      CHECK (status IN ('todo','in_progress','done')),
  estimated_minutes INT CHECK (estimated_minutes > 0),
  is_billable       BOOLEAN NOT NULL DEFAULT TRUE,
  position          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON tasks
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "tasks_insert" ON tasks
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "tasks_update" ON tasks
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "tasks_delete" ON tasks
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_project_position
  ON tasks (tenant_id, project_id, position);

-- ============================================================
-- 4. time_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS time_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date        DATE NOT NULL,
  minutes           INT NOT NULL CHECK (minutes > 0),
  notes             TEXT,
  is_billable       BOOLEAN NOT NULL DEFAULT TRUE,
  rate_snapshot     NUMERIC(10,2),
  approval_status   TEXT NOT NULL DEFAULT 'pending'
                      CHECK (approval_status IN ('pending','approved','rejected')),
  approved_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- All tenant members can read entries within their tenant
CREATE POLICY "time_entries_select" ON time_entries
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Members insert only their own entries
CREATE POLICY "time_entries_insert" ON time_entries
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
  );

-- Members can update their own pending entries; admins can update any
CREATE POLICY "time_entries_update" ON time_entries
  FOR UPDATE USING (
    (user_id = auth.uid() AND approval_status = 'pending')
    OR is_tenant_admin(tenant_id)
  );

-- Only admins can delete entries
CREATE POLICY "time_entries_delete" ON time_entries
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_user_date
  ON time_entries (tenant_id, user_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_project_date
  ON time_entries (tenant_id, project_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_tenant_pending
  ON time_entries (tenant_id) WHERE approval_status = 'pending';

-- ============================================================
-- 5. Extend existing tables
-- ============================================================

-- tenant_users: per-member default billing rate
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS default_hourly_rate NUMERIC(10,2);

-- leads: optional account link (contact belongs to an account)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_account_id
  ON leads (account_id) WHERE account_id IS NOT NULL;

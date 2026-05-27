-- ============================================================
-- 024: project workspace fields
-- Adds task assignment + categorization + ownership semantics
-- needed for the unified project workspace.
-- ============================================================

-- tasks: assignment + scheduling + categorization
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date    DATE,
  ADD COLUMN IF NOT EXISTS priority    TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS tags        TEXT[] NOT NULL DEFAULT '{}';

-- projects: owner (Client Services Lead — UI label flexible)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- accounts: owner (Account Manager — UI label flexible)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee
  ON tasks (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_due
  ON tasks (tenant_id, due_date) WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_priority
  ON tasks (tenant_id, priority);

CREATE INDEX IF NOT EXISTS idx_tasks_tags
  ON tasks USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_owner
  ON projects (tenant_id, owner_id) WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_owner
  ON accounts (tenant_id, owner_id) WHERE owner_id IS NOT NULL;

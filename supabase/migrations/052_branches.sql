CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_select" ON branches
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "branches_insert" ON branches
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "branches_update" ON branches
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "branches_delete" ON branches
  FOR DELETE USING (is_tenant_admin(tenant_id));

ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_branch        ON leads(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_branch ON tenant_users(tenant_id, branch_id);

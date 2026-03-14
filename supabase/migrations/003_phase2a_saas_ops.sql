-- Phase 2A: SaaS Operational Layer
-- Adds: stage_id, assigned_to, intake fields, counselor role, invite_tokens, lead_checklists

BEGIN;

-- 1A. Add stage_id to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_stage_id ON leads(stage_id);

-- Backfill stage_id from status slug
UPDATE leads SET stage_id = ps.id
FROM pipeline_stages ps
WHERE leads.tenant_id = ps.tenant_id AND leads.status = ps.slug AND leads.stage_id IS NULL;

-- 1B. Add assigned_to to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON leads(assigned_to) WHERE deleted_at IS NULL;

-- 1C. Add intake + preference fields to leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_source VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_medium VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intake_campaign VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR(50);

-- 1D. Expand tenant_users role to include counselor
ALTER TABLE tenant_users DROP CONSTRAINT IF EXISTS tenant_users_role_check;
ALTER TABLE tenant_users ADD CONSTRAINT tenant_users_role_check
  CHECK (role IN ('owner', 'admin', 'viewer', 'counselor'));

-- 1E. Create invite_tokens table
CREATE TABLE IF NOT EXISTS invite_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'viewer', 'counselor')),
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_tenant ON invite_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX IF NOT EXISTS idx_invite_tokens_email ON invite_tokens(email, tenant_id);

ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins can view invites" ON invite_tokens
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM tenant_users
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

-- 1F. Create lead_checklists table
CREATE TABLE IF NOT EXISTS lead_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_checklists_lead ON lead_checklists(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_checklists_tenant ON lead_checklists(tenant_id);

ALTER TABLE lead_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view lead checklists" ON lead_checklists
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Apply update_updated_at trigger to lead_checklists
CREATE TRIGGER update_lead_checklists_updated_at
  BEFORE UPDATE ON lead_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 1G. New helper function: get_user_tenant_role
CREATE OR REPLACE FUNCTION get_user_tenant_role(p_tenant_id UUID) RETURNS VARCHAR
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT role FROM tenant_users WHERE tenant_id = p_tenant_id AND user_id = auth.uid() LIMIT 1; $$;

COMMIT;

-- Migration 046: Deals / Opportunities (it_agency feature)
-- Additive + idempotent. Dormant until an it_agency tenant uses it.

-- 1. deal_stages (mirrors pipeline_stages, isolated from leads) ------------
CREATE TABLE IF NOT EXISTS deal_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7) DEFAULT '#6b7280',
  is_default BOOLEAN DEFAULT false,
  is_terminal BOOLEAN DEFAULT false,
  terminal_type VARCHAR(10) CHECK (terminal_type IN ('won','lost')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_deal_stages_tenant ON deal_stages(tenant_id, position);

ALTER TABLE deal_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deal_stages_select" ON deal_stages
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "deal_stages_insert" ON deal_stages
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deal_stages_update" ON deal_stages
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deal_stages_delete" ON deal_stages
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_deal_stages_updated_at
  BEFORE UPDATE ON deal_stages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. deals -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  stage_id UUID NOT NULL REFERENCES deal_stages(id),
  amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'NPR',
  close_date DATE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deal_type TEXT,
  priority TEXT CHECK (priority IN ('low','medium','high')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_stage ON deals(tenant_id, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_account ON deals(tenant_id, account_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_owner ON deals(tenant_id, owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_tenant_live ON deals(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deals_select" ON deals
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "deals_insert" ON deals
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deals_update" ON deals
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "deals_delete" ON deals
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_deals_updated_at
  BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Seed 6 default deal_stages for existing it_agency tenants -------------
INSERT INTO deal_stages (tenant_id, name, slug, position, color, is_default, is_terminal, terminal_type)
SELECT t.id, s.name, s.slug, s.position, s.color, s.is_default, s.is_terminal, s.terminal_type
FROM tenants t
CROSS JOIN (VALUES
  ('Qualification',  'qualification',  0, '#3b82f6', true,  false, NULL),
  ('Needs Analysis', 'needs-analysis', 1, '#8b5cf6', false, false, NULL),
  ('Proposal',       'proposal',       2, '#f59e0b', false, false, NULL),
  ('Negotiation',    'negotiation',    3, '#f97316', false, false, NULL),
  ('Closed Won',     'closed-won',     4, '#22c55e', false, true,  'won'),
  ('Closed Lost',    'closed-lost',    5, '#ef4444', false, true,  'lost')
) AS s(name, slug, position, color, is_default, is_terminal, terminal_type)
WHERE t.industry_id = 'it_agency'
ON CONFLICT (tenant_id, slug) DO NOTHING;

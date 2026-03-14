-- Phase 1.5 — Foundation Stabilization
-- ======================================

-- 1. Soft delete on leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_not_deleted ON leads(tenant_id) WHERE deleted_at IS NULL;

-- 2. Idempotency key on leads (scoped per tenant)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
ALTER TABLE leads ADD CONSTRAINT uq_leads_tenant_idempotency UNIQUE (tenant_id, idempotency_key);

-- Remove the status CHECK constraint so we can use pipeline_stages instead
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;

-- 3. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  changes JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view audit logs" ON audit_logs
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- No INSERT policy — service role only writes

-- 4. Events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins can view events" ON events
  FOR SELECT USING (is_tenant_admin(tenant_id));

-- 5. Pipeline Stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color VARCHAR(7) DEFAULT '#6b7280',
  is_default BOOLEAN DEFAULT false,
  is_terminal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view pipeline stages" ON pipeline_stages
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Public can read pipeline stages" ON pipeline_stages
  FOR SELECT TO anon USING (true);
CREATE POLICY "Admins can insert pipeline stages" ON pipeline_stages
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can update pipeline stages" ON pipeline_stages
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "Admins can delete pipeline stages" ON pipeline_stages
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_pipeline_stages_updated_at
  BEFORE UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed existing statuses for all current tenants
INSERT INTO pipeline_stages (tenant_id, name, slug, position, color, is_default, is_terminal)
SELECT t.id, s.name, s.slug, s.position, s.color, s.is_default, s.is_terminal
FROM tenants t
CROSS JOIN (VALUES
  ('New',       'new',       0, '#3b82f6', true,  false),
  ('Partial',   'partial',   1, '#f97316', false, false),
  ('Contacted', 'contacted', 2, '#a855f7', false, false),
  ('Enrolled',  'enrolled',  3, '#22c55e', false, true),
  ('Rejected',  'rejected',  4, '#ef4444', false, true)
) AS s(name, slug, position, color, is_default, is_terminal)
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 6. Rate Limits
CREATE TABLE IF NOT EXISTS rate_limits (
  key VARCHAR(255) PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies — service role access only

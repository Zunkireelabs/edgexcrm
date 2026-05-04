-- Email auto-forward rules: send emails to leads when they enter specific pipeline stages
CREATE TABLE email_forward_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  smtp_email VARCHAR(255) NOT NULL,
  smtp_password TEXT NOT NULL,
  smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  subject VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup on stage change
CREATE INDEX idx_email_forward_rules_lookup
  ON email_forward_rules (tenant_id, stage_id)
  WHERE is_active = true;

-- Auto-update updated_at
CREATE TRIGGER set_email_forward_rules_updated_at
  BEFORE UPDATE ON email_forward_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE email_forward_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view email rules"
  ON email_forward_rules FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can insert email rules"
  ON email_forward_rules FOR INSERT
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can update email rules"
  ON email_forward_rules FOR UPDATE
  USING (is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can delete email rules"
  ON email_forward_rules FOR DELETE
  USING (is_tenant_admin(tenant_id));

-- Service role bypass
CREATE POLICY "Service role full access to email rules"
  ON email_forward_rules FOR ALL
  USING (auth.role() = 'service_role');

-- Connected email accounts for OAuth-based email sending
CREATE TABLE connected_email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL DEFAULT 'gmail',
  email VARCHAR(255) NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expiry TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connected_email_accounts_tenant
  ON connected_email_accounts (tenant_id);

CREATE TRIGGER set_connected_email_accounts_updated_at
  BEFORE UPDATE ON connected_email_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE connected_email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view connected accounts"
  ON connected_email_accounts FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can insert connected accounts"
  ON connected_email_accounts FOR INSERT
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can update connected accounts"
  ON connected_email_accounts FOR UPDATE
  USING (is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can delete connected accounts"
  ON connected_email_accounts FOR DELETE
  USING (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to connected accounts"
  ON connected_email_accounts FOR ALL
  USING (auth.role() = 'service_role');

-- Add email_account_id to email_forward_rules
ALTER TABLE email_forward_rules
  ADD COLUMN email_account_id UUID REFERENCES connected_email_accounts(id) ON DELETE SET NULL;

-- Make SMTP fields nullable (backward compat for existing rules)
ALTER TABLE email_forward_rules
  ALTER COLUMN smtp_email DROP NOT NULL,
  ALTER COLUMN smtp_password DROP NOT NULL,
  ALTER COLUMN smtp_host DROP NOT NULL,
  ALTER COLUMN smtp_port DROP NOT NULL;

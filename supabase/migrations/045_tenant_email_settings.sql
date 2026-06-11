CREATE TABLE IF NOT EXISTS tenant_email_settings (
  tenant_id        UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  from_name        TEXT,            -- e.g. "Admizz Education"
  from_address     TEXT,            -- e.g. "hello@admizz.com" (used ONLY when domain_verified)
  reply_to         TEXT,            -- e.g. "hello@admizz.com"
  domain_verified  BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE tenant_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view email settings"
  ON tenant_email_settings FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate email settings"
  ON tenant_email_settings FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to email settings"
  ON tenant_email_settings FOR ALL
  USING (auth.role() = 'service_role');

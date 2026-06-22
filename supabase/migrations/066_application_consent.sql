-- Migration 066: Application Consent Gate (education_consultancy feature)
-- Additive + idempotent. Gate is OFF by default — absence of a row (or is_active=false) means no gate.

BEGIN;

-- 1. consent_templates (one per tenant, drives whether the gate is on) -------

CREATE TABLE IF NOT EXISTS consent_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Student Consent & Authorization',
  body TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  require_drawn_signature BOOLEAN NOT NULL DEFAULT false,
  link_expiry_days INT NOT NULL DEFAULT 14,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consent_templates_select" ON consent_templates
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "consent_templates_insert" ON consent_templates
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "consent_templates_update" ON consent_templates
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "consent_templates_delete" ON consent_templates
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_consent_templates_updated_at
  BEFORE UPDATE ON consent_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. lead_consents (per-student consent record + token) ---------------------

CREATE TABLE IF NOT EXISTS lead_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sent',            -- 'sent' | 'signed' | 'expired'
  method TEXT,                                    -- 'esign' | 'manual_upload'
  token TEXT,                                     -- random UUID, for the public signing link
  body_snapshot TEXT,                             -- exact doc text frozen at send time
  template_version INT,
  signer_name TEXT,
  signature_type TEXT,                            -- 'typed' | 'drawn'
  signature_value TEXT,
  signature_image_url TEXT,                       -- drawn signature PNG (lead-documents bucket)
  document_url TEXT,                              -- uploaded signed scan (manual path)
  ip_address TEXT,
  sent_at TIMESTAMPTZ,
  sent_via TEXT,                                  -- 'link' | 'email'
  link_expires_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_consents_tenant_lead
  ON lead_consents(tenant_id, lead_id) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_consents_token
  ON lead_consents(token) WHERE token IS NOT NULL;

ALTER TABLE lead_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_consents_select" ON lead_consents
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_consents_insert" ON lead_consents
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_consents_update" ON lead_consents
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_consents_delete" ON lead_consents
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_lead_consents_updated_at
  BEFORE UPDATE ON lead_consents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Before/after verification counts (both expected = 0)
-- SELECT count(*) FROM consent_templates;
-- SELECT count(*) FROM lead_consents;

COMMIT;

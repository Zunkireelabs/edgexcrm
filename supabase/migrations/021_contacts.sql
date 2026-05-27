-- 021_contacts.sql
-- Phase A: CRM Contacts schema for it_agency industry

-- contacts table
CREATE TABLE contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  title               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  assigned_to         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trigger_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_contacts_tenant_account ON contacts(tenant_id, account_id);
CREATE INDEX idx_contacts_tenant_email ON contacts(tenant_id, email) WHERE deleted_at IS NULL;

-- project_contacts junction table
CREATE TABLE project_contacts (
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role         TEXT CHECK (role IN ('primary','technical','billing','other')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contact_id)
);
CREATE UNIQUE INDEX project_contacts_one_primary ON project_contacts(project_id) WHERE role = 'primary';
CREATE INDEX idx_project_contacts_contact ON project_contacts(contact_id);

-- leads ALTER: conversion plumbing
ALTER TABLE leads
  ADD COLUMN converted_at         TIMESTAMPTZ,
  ADD COLUMN converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_converted ON leads(tenant_id) WHERE converted_at IS NOT NULL;

-- accounts ALTER: primary contact link
ALTER TABLE accounts
  ADD COLUMN primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

-- RLS: contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select" ON contacts
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "contacts_insert" ON contacts
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "contacts_update" ON contacts
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "contacts_delete" ON contacts
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- RLS: project_contacts
ALTER TABLE project_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_contacts_select" ON project_contacts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.tenant_id IN (SELECT get_user_tenant_ids())
    )
  );

CREATE POLICY "project_contacts_insert" ON project_contacts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id)
    )
  );

CREATE POLICY "project_contacts_delete" ON project_contacts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id)
    )
  );

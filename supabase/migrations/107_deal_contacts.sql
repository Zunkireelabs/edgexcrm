-- Migration 107: deal_contacts junction — multiple contacts per deal with roles.
-- Mirrors project_contacts (mig 021) + the both-sides RLS hardening (mig 022).
-- Additive, idempotent, transaction-wrapped. it_agency Deals feature.
BEGIN;

CREATE TABLE IF NOT EXISTS deal_contacts (
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role       TEXT CHECK (role IN ('primary','technical','billing','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deal_id, contact_id)          -- a contact appears once per deal
);

-- At most one 'primary' contact per deal.
CREATE UNIQUE INDEX IF NOT EXISTS deal_contacts_one_primary
  ON deal_contacts(deal_id) WHERE role = 'primary';
CREATE INDEX IF NOT EXISTS idx_deal_contacts_contact ON deal_contacts(contact_id);

ALTER TABLE deal_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_contacts_select" ON deal_contacts FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND c.tenant_id IN (SELECT get_user_tenant_ids()))
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND d.tenant_id IN (SELECT get_user_tenant_ids()))
);
CREATE POLICY "deal_contacts_insert" ON deal_contacts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_tenant_admin(d.tenant_id))
);
CREATE POLICY "deal_contacts_delete" ON deal_contacts FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_tenant_admin(d.tenant_id))
);
CREATE POLICY "deal_contacts_update" ON deal_contacts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_tenant_admin(d.tenant_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id AND is_tenant_admin(c.tenant_id))
  AND EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_id AND is_tenant_admin(d.tenant_id))
);

COMMIT;

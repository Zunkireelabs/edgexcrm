ALTER TABLE leads
  ADD COLUMN owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN salutation    VARCHAR(10),
  ADD COLUMN company_email VARCHAR(255);

CREATE INDEX idx_leads_owner ON leads (tenant_id, owner_id) WHERE deleted_at IS NULL;

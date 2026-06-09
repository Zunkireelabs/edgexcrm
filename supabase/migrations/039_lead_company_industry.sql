ALTER TABLE leads
  ADD COLUMN company_name      VARCHAR(255),
  ADD COLUMN designation       VARCHAR(255),
  ADD COLUMN prospect_industry VARCHAR(64);

CREATE INDEX idx_leads_prospect_industry
  ON leads (tenant_id, prospect_industry) WHERE deleted_at IS NULL;

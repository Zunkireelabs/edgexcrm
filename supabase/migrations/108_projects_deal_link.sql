-- Migration 108: link a project back to the deal it was converted from.
-- Additive, idempotent, transaction-wrapped. it_agency Deals→Project conversion.
BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

-- One deal converts to at most one project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_deal_id
  ON projects(deal_id) WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_deal_id ON projects(deal_id);

COMMIT;

-- Migration 238: lead_references (education_consultancy student record — Professional Information)
--
-- Repeatable, one-to-many ("let us add as many; sort by number" per the
-- client's PDF template) — same normalized-child-table pattern as
-- `lead_work_experience` (237).
--
-- NOT YET APPLIED to any database (stage or prod) — written for review only,
-- per this repo's "no DB access" rule. Apply via the normal PR pipeline.
--   Rollback: DROP TABLE IF EXISTS lead_references;

BEGIN;

CREATE TABLE IF NOT EXISTS lead_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  referee_name TEXT,
  position TEXT,
  organization TEXT,
  email TEXT,
  address TEXT,
  relationship TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_references_lead ON lead_references(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_references_tenant ON lead_references(tenant_id);

ALTER TABLE lead_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_references_select" ON lead_references
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_references_insert" ON lead_references
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_references_update" ON lead_references
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_references_delete" ON lead_references
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_lead_references_updated_at
  BEFORE UPDATE ON lead_references FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('238_lead_references.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 237: lead_work_experience (education_consultancy student record — Professional Information)
--
-- Repeatable, one-to-many ("let us add as many; sort by date" per the client's
-- PDF template) — same normalized-child-table pattern as `applications`
-- (057) and `lead_test_scores` (235): own table, tenant_id + lead_id FK, RLS
-- via the standard SECURITY DEFINER helpers.
--
-- NOT YET APPLIED to any database (stage or prod) — written for review only,
-- per this repo's "no DB access" rule. Apply via the normal PR pipeline.
--   Rollback: DROP TABLE IF EXISTS lead_work_experience;

BEGIN;

CREATE TABLE IF NOT EXISTS lead_work_experience (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  institution_name TEXT,
  address TEXT,
  position TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_work_experience_lead ON lead_work_experience(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_work_experience_tenant ON lead_work_experience(tenant_id);

ALTER TABLE lead_work_experience ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_work_experience_select" ON lead_work_experience
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_work_experience_insert" ON lead_work_experience
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_work_experience_update" ON lead_work_experience
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_work_experience_delete" ON lead_work_experience
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_lead_work_experience_updated_at
  BEFORE UPDATE ON lead_work_experience FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('237_lead_work_experience.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

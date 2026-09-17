-- Migration 235: lead_test_scores (education_consultancy student record — Academic Information)
--
-- A student can sit the same test more than once, or sit different tests
-- (IELTS + GRE, etc.) — that repeatable, one-to-many shape doesn't fit as flat
-- columns on `leads` the way the single-value academic fields did (migration
-- 159). Follows the same normalized-child-table pattern as `applications`
-- (migration 057): own table, tenant_id + lead_id FK, RLS via the standard
-- SECURITY DEFINER helpers.
--
-- NOT YET APPLIED to any database (stage or prod) — written for review only,
-- per this repo's "no DB access" rule. Apply via the normal PR pipeline.
--   Rollback: DROP TABLE IF EXISTS lead_test_scores;

BEGIN;

CREATE TABLE IF NOT EXISTS lead_test_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL, -- "IELTS" | "TOEFL" | "PTE" | "Duolingo English Test" | "Other Tests"
  date_of_exam DATE,
  listening TEXT,
  reading TEXT,
  writing TEXT,
  speaking TEXT,
  overall TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_test_scores_lead ON lead_test_scores(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_test_scores_tenant ON lead_test_scores(tenant_id);

ALTER TABLE lead_test_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_test_scores_select" ON lead_test_scores
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_test_scores_insert" ON lead_test_scores
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_test_scores_update" ON lead_test_scores
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_test_scores_delete" ON lead_test_scores
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_lead_test_scores_updated_at
  BEFORE UPDATE ON lead_test_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('235_lead_test_scores.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

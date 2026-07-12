-- Migration 136: it_agency Delivery — RAID Risk Register (the "R")
--
-- Adds `project_risks`, a structured risk register: probability x impact
-- (scored in app, not stored — see src/industries/it-agency/features/
-- project-board/lib/risk.ts), a mitigation plan, an owner, and a lifecycle
-- (open -> mitigating -> closed / occurred). Mirrors `project_issues`
-- (128_delivery_workflow.sql) shape + RLS exactly.
--
-- 134 = deal_project_handoff (renamed from 129 at rebase); 133 = invoicing,
-- 135 = task timers — this is 136.
--
-- Expected before/after row counts: project_risks 0 -> 0 rows (new table, no seed).
--
-- Rollback:
--   DROP TABLE IF EXISTS project_risks CASCADE;
--
-- Applied: local only (2026-07-10) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS project_risks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  probability   TEXT NOT NULL DEFAULT 'medium' CHECK (probability IN ('low','medium','high')),
  impact        TEXT NOT NULL DEFAULT 'medium' CHECK (impact IN ('low','medium','high')),
  mitigation    TEXT,
  owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigating','closed','occurred')),
  review_date   DATE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_risks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_risks_select" ON project_risks;
CREATE POLICY "project_risks_select" ON project_risks
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_risks_insert" ON project_risks;
CREATE POLICY "project_risks_insert" ON project_risks
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_risks_update" ON project_risks;
CREATE POLICY "project_risks_update" ON project_risks
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_risks_delete" ON project_risks;
CREATE POLICY "project_risks_delete" ON project_risks
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_project_risks_tenant_project_status
  ON project_risks (tenant_id, project_id, status);

DROP TRIGGER IF EXISTS trigger_project_risks_updated_at ON project_risks;
CREATE TRIGGER trigger_project_risks_updated_at
  BEFORE UPDATE ON project_risks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('136_project_risks.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

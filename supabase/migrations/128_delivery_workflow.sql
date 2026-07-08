-- Migration 128: it_agency Delivery Workflow Phase 1
--
-- Adds the Brief/Qualify/Control layer to `projects` (12 new nullable columns,
-- 0 rows touched — all additive) plus 5 new tenant-owned tables:
--   project_events            — append-only decision/event ledger (the memory seam)
--   project_milestones        — deliverable acceptance
--   project_issues            — client queries / issues surface
--   project_change_requests   — scope-change gate (amends the baseline estimate)
--   project_status_reports    — the Report artifact
--
-- Expected before/after row counts: projects 0 rows touched (+12 nullable columns,
-- 0-row backfill risk); project_events/project_milestones/project_issues/
-- project_change_requests/project_status_reports: 0 -> 0 rows (new tables, no seed).
--
-- Rollback:
--   DROP TABLE IF EXISTS project_change_requests CASCADE;
--   DROP TABLE IF EXISTS project_issues CASCADE;
--   DROP TABLE IF EXISTS project_milestones CASCADE;
--   DROP TABLE IF EXISTS project_status_reports CASCADE;
--   DROP TABLE IF EXISTS project_events CASCADE;
--   ALTER TABLE projects
--     DROP COLUMN IF EXISTS brief,
--     DROP COLUMN IF EXISTS engagement_model,
--     DROP COLUMN IF EXISTS definition_of_done,
--     DROP COLUMN IF EXISTS baseline_estimate_minutes,
--     DROP COLUMN IF EXISTS current_estimate_minutes,
--     DROP COLUMN IF EXISTS budget_amount,
--     DROP COLUMN IF EXISTS start_date,
--     DROP COLUMN IF EXISTS target_end_date,
--     DROP COLUMN IF EXISTS health_override,
--     DROP COLUMN IF EXISTS health_note,
--     DROP COLUMN IF EXISTS qualified_at,
--     DROP COLUMN IF EXISTS qualified_by;
--
-- Applied: local 2026-07-08 / stage HELD / prod HELD.

BEGIN;

-- ============================================================
-- 1a. projects — Brief/Qualify/Control columns (all additive, nullable)
-- ============================================================
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS brief TEXT,
  ADD COLUMN IF NOT EXISTS engagement_model TEXT,
  ADD COLUMN IF NOT EXISTS definition_of_done TEXT,
  ADD COLUMN IF NOT EXISTS baseline_estimate_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS current_estimate_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS target_end_date DATE,
  ADD COLUMN IF NOT EXISTS health_override TEXT,
  ADD COLUMN IF NOT EXISTS health_note TEXT,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_engagement_model_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_engagement_model_check
  CHECK (engagement_model IN ('fixed_bid','time_materials','retainer','staff_aug'));

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_health_override_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_health_override_check
  CHECK (health_override IN ('green','amber','red'));

-- ============================================================
-- 1b. project_events — append-only decision/event ledger (CROWN JEWEL)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  actor_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  summary       TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  subject_type  TEXT,
  subject_id    UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_events_select" ON project_events;
CREATE POLICY "project_events_select" ON project_events
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_events_insert" ON project_events;
CREATE POLICY "project_events_insert" ON project_events
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

-- Deliberately append-only: NO UPDATE and NO DELETE policy. The ledger is
-- immutable even to admins. Do not add them.

CREATE INDEX IF NOT EXISTS idx_project_events_tenant_project_occurred
  ON project_events (tenant_id, project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_events_tenant_type
  ON project_events (tenant_id, event_type);

-- ============================================================
-- 1c. project_milestones — deliverable acceptance
-- ============================================================
CREATE TABLE IF NOT EXISTS project_milestones (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  due_date         DATE,
  sort_order       INT NOT NULL DEFAULT 0,
  amount           NUMERIC(12,2),
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','submitted','accepted','rejected')),
  accepted_at      TIMESTAMPTZ,
  accepted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_milestones_select" ON project_milestones;
CREATE POLICY "project_milestones_select" ON project_milestones
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_milestones_insert" ON project_milestones;
CREATE POLICY "project_milestones_insert" ON project_milestones
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_milestones_update" ON project_milestones;
CREATE POLICY "project_milestones_update" ON project_milestones
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_milestones_delete" ON project_milestones;
CREATE POLICY "project_milestones_delete" ON project_milestones
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_project_milestones_tenant_project_sort
  ON project_milestones (tenant_id, project_id, sort_order);

DROP TRIGGER IF EXISTS trigger_project_milestones_updated_at ON project_milestones;
CREATE TRIGGER trigger_project_milestones_updated_at
  BEFORE UPDATE ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 1d. project_issues — client queries / issues surface
-- ============================================================
CREATE TABLE IF NOT EXISTS project_issues (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  kind                 TEXT NOT NULL DEFAULT 'query'    CHECK (kind IN ('query','issue','blocker')),
  severity             TEXT NOT NULL DEFAULT 'medium'   CHECK (severity IN ('low','medium','high')),
  status               TEXT NOT NULL DEFAULT 'open'     CHECK (status IN ('open','in_progress','resolved','closed')),
  source               TEXT NOT NULL DEFAULT 'internal' CHECK (source IN ('internal','client')),
  raised_by_label      TEXT,
  raised_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  assigned_to          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_issues_select" ON project_issues;
CREATE POLICY "project_issues_select" ON project_issues
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_issues_insert" ON project_issues;
CREATE POLICY "project_issues_insert" ON project_issues
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_issues_update" ON project_issues;
CREATE POLICY "project_issues_update" ON project_issues
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_issues_delete" ON project_issues;
CREATE POLICY "project_issues_delete" ON project_issues
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_project_issues_tenant_project_status
  ON project_issues (tenant_id, project_id, status);

DROP TRIGGER IF EXISTS trigger_project_issues_updated_at ON project_issues;
CREATE TRIGGER trigger_project_issues_updated_at
  BEFORE UPDATE ON project_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 1e. project_change_requests — scope-change gate (amends the baseline)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_change_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id             UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  description            TEXT,
  classification         TEXT NOT NULL DEFAULT 'new_scope' CHECK (classification IN ('in_scope','new_scope')),
  estimate_delta_minutes INTEGER NOT NULL DEFAULT 0,
  budget_delta_amount    NUMERIC(12,2),
  status                 TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  client_approved        BOOLEAN NOT NULL DEFAULT false,
  origin_issue_id        UUID REFERENCES project_issues(id) ON DELETE SET NULL,
  decided_at             TIMESTAMPTZ,
  decided_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_change_requests_select" ON project_change_requests;
CREATE POLICY "project_change_requests_select" ON project_change_requests
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_change_requests_insert" ON project_change_requests;
CREATE POLICY "project_change_requests_insert" ON project_change_requests
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_change_requests_update" ON project_change_requests;
CREATE POLICY "project_change_requests_update" ON project_change_requests
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_change_requests_delete" ON project_change_requests;
CREATE POLICY "project_change_requests_delete" ON project_change_requests
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_project_change_requests_tenant_project_status
  ON project_change_requests (tenant_id, project_id, status);

DROP TRIGGER IF EXISTS trigger_project_change_requests_updated_at ON project_change_requests;
CREATE TRIGGER trigger_project_change_requests_updated_at
  BEFORE UPDATE ON project_change_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 1f. project_status_reports — the Report artifact
-- ============================================================
CREATE TABLE IF NOT EXISTS project_status_reports (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date             DATE NOT NULL DEFAULT current_date,
  period_start            DATE,
  period_end              DATE,
  health_snapshot         TEXT CHECK (health_snapshot IN ('green','amber','red')),
  summary                 TEXT,
  pct_complete_snapshot   INTEGER,
  hours_actual_snapshot   INTEGER,
  hours_estimate_snapshot INTEGER,
  is_client_visible       BOOLEAN NOT NULL DEFAULT false,
  published_at            TIMESTAMPTZ,
  published_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_status_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_status_reports_select" ON project_status_reports;
CREATE POLICY "project_status_reports_select" ON project_status_reports
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "project_status_reports_insert" ON project_status_reports;
CREATE POLICY "project_status_reports_insert" ON project_status_reports
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_status_reports_update" ON project_status_reports;
CREATE POLICY "project_status_reports_update" ON project_status_reports
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "project_status_reports_delete" ON project_status_reports;
CREATE POLICY "project_status_reports_delete" ON project_status_reports
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_project_status_reports_tenant_project_date
  ON project_status_reports (tenant_id, project_id, report_date DESC);

DROP TRIGGER IF EXISTS trigger_project_status_reports_updated_at ON project_status_reports;
CREATE TRIGGER trigger_project_status_reports_updated_at
  BEFORE UPDATE ON project_status_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('128_delivery_workflow.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 179: agent_identities / agent_runs / agent_outputs — Phase 5 agent spine
--
-- AI-native Phase 5 (docs/ai-native-efforts/03-PHASE-3-BACKGROUND-AGENTS.md §1,
-- 00-DECISIONS-ADR.md Decision 2). An agent is a first-class tenant team member:
-- an identity with a position (the existing positions/RBAC permission profile),
-- runs it produces, and drafts/suggestions it proposes for human review. Ships
-- no consumer yet — this is schema + the per-tenant kill switch only. No app
-- code writes to these tables until slice 5.1b (the Inngest agent runtime).
--
-- Per-tenant kill switch: tenants.ai_agents_enabled mirrors ai_enabled (mig 174).
-- DEFAULT false is deliberate and load-bearing — every tenant lands opted-out.
-- Never backfill any tenant to true in this or any migration.
--
-- Tenant isolation: tenant_id FK + RLS on all three tables — SELECT via
-- get_user_tenant_ids(), mutations via is_tenant_admin(tenant_id). Mirrors the
-- house pattern (ai_conversations/ai_messages/ai_usage_events, mig 168).
--
-- Expected before/after row counts: agent_identities 0 -> 0, agent_runs 0 -> 0,
-- agent_outputs 0 -> 0 (new tables, no seed). public.tenants row count
-- unchanged (nullable-free, defaulted column added only); all existing rows
-- land as ai_agents_enabled = false.
--
-- Rollback:
--   DROP TABLE IF EXISTS agent_outputs CASCADE;
--   DROP TABLE IF EXISTS agent_runs CASCADE;
--   DROP TABLE IF EXISTS agent_identities CASCADE;
--   ALTER TABLE public.tenants DROP COLUMN IF EXISTS ai_agents_enabled;
--
-- Applied: local only (2026-07-23) / stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS ai_agents_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS agent_identities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_key     TEXT NOT NULL,                          -- 'lead-triage', 'follow-up-drafter' … (registry constant)
  display_name  TEXT NOT NULL,
  position_id   UUID REFERENCES positions(id),          -- permission profile, same as humans
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,      -- per-tenant overrides (tone, thresholds, schedules)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_identities_tenant ON agent_identities (tenant_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id       UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  trigger_event  TEXT NOT NULL,                          -- 'lead.created', 'cron.daily-digest', 'manual'
  subject_type   TEXT,
  subject_id     UUID,                                   -- e.g. 'lead', <lead_id>
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  outputs        JSONB NOT NULL DEFAULT '[]'::jsonb,      -- refs to produced drafts/suggestions
  usage          JSONB NOT NULL DEFAULT '{}'::jsonb,      -- tokens, tool_calls, duration_ms
  error          TEXT,
  started_at     TIMESTAMPTZ DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_agent ON agent_runs (tenant_id, agent_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id        UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agent_identities(id),
  kind          TEXT NOT NULL,                           -- 'draft_email', 'lead_summary', 'score_suggestion', 'task_suggestion'
  subject_type  TEXT,
  subject_id    UUID,
  payload       JSONB NOT NULL,                          -- the draft content, structured
  status        TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'edited_accepted', 'dismissed', 'expired')),
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_tenant_run ON agent_outputs (tenant_id, run_id);

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_identities_select" ON agent_identities;
CREATE POLICY "agent_identities_select" ON agent_identities
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "agent_identities_insert" ON agent_identities;
CREATE POLICY "agent_identities_insert" ON agent_identities
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_identities_update" ON agent_identities;
CREATE POLICY "agent_identities_update" ON agent_identities
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_identities_delete" ON agent_identities;
CREATE POLICY "agent_identities_delete" ON agent_identities
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "agent_runs_select" ON agent_runs;
CREATE POLICY "agent_runs_select" ON agent_runs
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "agent_runs_insert" ON agent_runs;
CREATE POLICY "agent_runs_insert" ON agent_runs
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_runs_update" ON agent_runs;
CREATE POLICY "agent_runs_update" ON agent_runs
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_runs_delete" ON agent_runs;
CREATE POLICY "agent_runs_delete" ON agent_runs
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "agent_outputs_select" ON agent_outputs;
CREATE POLICY "agent_outputs_select" ON agent_outputs
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "agent_outputs_insert" ON agent_outputs;
CREATE POLICY "agent_outputs_insert" ON agent_outputs
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_outputs_update" ON agent_outputs;
CREATE POLICY "agent_outputs_update" ON agent_outputs
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_outputs_delete" ON agent_outputs;
CREATE POLICY "agent_outputs_delete" ON agent_outputs
  FOR DELETE USING (is_tenant_admin(tenant_id));

INSERT INTO public.schema_migrations (version) VALUES ('179_agent_identities.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

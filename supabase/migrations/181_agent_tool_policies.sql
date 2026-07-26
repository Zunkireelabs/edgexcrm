-- Migration 181: agent_tool_policies / agent_approvals — Phase 5.4a write-policy spine
--
-- AI-native Phase 5 slice 5.4a (docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md
-- §1). Schema-only: the per-(tenant, agent, tool) automation-level matrix and the
-- approval-queue table. No app code writes to agent_tool_policies yet (no UI), and
-- no app code reads agent_approvals yet (that lands in 5.4b) — creating both tables
-- now keeps 5.4b code-only, same rationale as mig 179's agent_outputs precedent.
--
-- Default-deny is the load-bearing invariant: a (tenant, agent, tool) triple with no
-- agent_tool_policies row resolves to 'human_led' in application code
-- (src/lib/ai/agents/policy.ts's resolveAutomationLevel), never an implicit grant.
-- automation_level DEFAULT 'human_led' here mirrors that at the schema level too.
--
-- Tenant isolation: tenant_id FK + RLS on both tables — SELECT via
-- get_user_tenant_ids(), mutations via is_tenant_admin(tenant_id). Mirrors the
-- house pattern (agent_identities/agent_runs/agent_outputs, mig 179).
--
-- Expected before/after row counts: agent_tool_policies 0 -> 0, agent_approvals
-- 0 -> 0 (new tables, no seed).
--
-- Rollback:
--   DROP TABLE IF EXISTS agent_approvals CASCADE;
--   DROP TABLE IF EXISTS agent_tool_policies CASCADE;
--
-- Applied: local only (2026-07-26) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS agent_tool_policies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  tool_id          TEXT NOT NULL,
  automation_level TEXT NOT NULL DEFAULT 'human_led'
    CHECK (automation_level IN ('human_led', 'agent_human', 'fully_automated')),
  updated_by       UUID,
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, agent_id, tool_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_policies_tenant_agent_tool
  ON agent_tool_policies (tenant_id, agent_id, tool_id);

CREATE TABLE IF NOT EXISTS agent_approvals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id        UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_id       TEXT NOT NULL,
  tool_input    JSONB NOT NULL,
  preview       JSONB,                          -- human-readable "what will happen"
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_at  TIMESTAMPTZ DEFAULT now(),
  decided_by    UUID,
  decided_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours')
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_tenant_status_expires
  ON agent_approvals (tenant_id, status, expires_at);

ALTER TABLE agent_tool_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tool_policies_select" ON agent_tool_policies;
CREATE POLICY "agent_tool_policies_select" ON agent_tool_policies
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "agent_tool_policies_insert" ON agent_tool_policies;
CREATE POLICY "agent_tool_policies_insert" ON agent_tool_policies
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_tool_policies_update" ON agent_tool_policies;
CREATE POLICY "agent_tool_policies_update" ON agent_tool_policies
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_tool_policies_delete" ON agent_tool_policies;
CREATE POLICY "agent_tool_policies_delete" ON agent_tool_policies
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "agent_approvals_select" ON agent_approvals;
CREATE POLICY "agent_approvals_select" ON agent_approvals
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "agent_approvals_insert" ON agent_approvals;
CREATE POLICY "agent_approvals_insert" ON agent_approvals
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_approvals_update" ON agent_approvals;
CREATE POLICY "agent_approvals_update" ON agent_approvals
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "agent_approvals_delete" ON agent_approvals;
CREATE POLICY "agent_approvals_delete" ON agent_approvals
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('181_agent_tool_policies.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

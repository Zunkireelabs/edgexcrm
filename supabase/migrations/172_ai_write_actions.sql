-- Migration 172: ai_write_actions — audit + idempotency spine for AI write tools
--
-- Phase 4A (docs/ai-native-efforts/working/BRIEF-PHASE-4A-WRITE-SPINE.md). Every
-- scope:"write" tool proposal/decision/execution is recorded here, keyed by the
-- SDK's toolCallId so an approval-response replay or retry never double-writes
-- (UNIQUE (tenant_id, tool_call_id) is the idempotency anchor). No app code
-- writes here yet on stage/prod — this slice ships flag-gated
-- (AI_WRITE_TOOLS_ENABLED, off everywhere but local) and stays additive.
--
-- Tenant isolation: tenant_id FK + RLS, SELECT only via get_user_tenant_ids() —
-- mirrors ai_usage_events (mig 168), but with NO insert/update/delete policies:
-- rows are written only by server code through the service-role-backed scoped
-- client (which bypasses RLS entirely), so a policy that "permits" mutations to
-- authenticated/anon roles would be dead weight security theater. Same posture
-- intent as ai_usage_events; here we just don't add row-level mutation policies
-- for roles that are never expected to hold direct table access.
--
-- Expected before/after row counts: ai_write_actions 0 -> 0 (new table, no seed).
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_write_actions CASCADE;
--
-- Applied: local only (2026-07-17) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_write_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  conversation_id UUID,
  tool_call_id    TEXT NOT NULL,
  tool_id         TEXT NOT NULL,
  input           JSONB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('executed', 'denied', 'failed')),
  result          JSONB,
  error           TEXT,
  undo_of         UUID REFERENCES ai_write_actions(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tool_call_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_write_actions_tenant_created
  ON ai_write_actions (tenant_id, created_at DESC);

ALTER TABLE ai_write_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_write_actions_select" ON ai_write_actions;
CREATE POLICY "ai_write_actions_select" ON ai_write_actions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

INSERT INTO public.schema_migrations (version) VALUES ('172_ai_write_actions.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

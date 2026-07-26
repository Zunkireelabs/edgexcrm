-- Migration 182: agent/run provenance on ai_write_actions — Phase 5 slice 5.4c
--
-- 04-PHASE-4-AUTONOMY-AND-WRITES.md / Phase 5 slice 5.4c (first agent_human
-- write tool: create_task). ai_write_actions.user_id is NOT NULL (mig 173)
-- and a background agent has no auth.users row, so an agent-approved write
-- is attributed to the approving human (agent_approvals.decided_by) as
-- user_id — these two columns add the agent/run as provenance alongside that
-- human actor, without touching the NOT NULL user_id column or its meaning.
--
-- Nullable because interactive-chat writes (adapter.ts) have no agent_id/run_id
-- at all — those columns are agent-run-execution-only.
--
-- Tenant isolation: no new RLS needed — both columns live on ai_write_actions,
-- which already has tenant_id FK + RLS (mig 173); this migration only adds
-- columns + an index.
--
-- Expected before/after row counts: ai_write_actions row count unchanged
-- (nullable columns added only, no existing rows to backfill).
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_ai_write_actions_tenant_agent;
--   ALTER TABLE public.ai_write_actions DROP COLUMN IF EXISTS agent_id;
--   ALTER TABLE public.ai_write_actions DROP COLUMN IF EXISTS run_id;
--
-- Applied: local only / stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.ai_write_actions
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agent_identities(id),
  ADD COLUMN IF NOT EXISTS run_id UUID REFERENCES agent_runs(id);

CREATE INDEX IF NOT EXISTS idx_ai_write_actions_tenant_agent
  ON public.ai_write_actions (tenant_id, agent_id);

INSERT INTO public.schema_migrations (version) VALUES ('182_ai_write_actions_agent_provenance.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

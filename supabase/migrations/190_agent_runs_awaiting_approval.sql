-- Migration 190: 'awaiting_approval' status on agent_runs
--
-- Phase 5 slice 5.4d (docs/ai-native-efforts/working/BRIEF-PHASE-5-4D-APPROVAL-UX-AND-MATRIX.md
-- Part 1/2). runAgent (runtime.ts) marks a run 'completed' as soon as its tool
-- loop returns, then runWriteApprovalGate (approval-gate.ts) can durably wait
-- up to 48h for a human decision on any agent_human write proposals it
-- produced — during that whole window the Fleet card and detail drawer read
-- "Completed", which is dishonest (open item #2 from the phase state). This
-- widens the CHECK so the gate can set the run to 'awaiting_approval' while
-- proposals are outstanding, then back to 'completed' once every wait
-- resolves. Modeled directly on mig 189's identical drop/re-add shape
-- against ai_write_actions.status.
--
-- Additive only — widens an existing CHECK constraint, no data touched.
--
-- Expected before/after row counts: agent_runs row count unchanged (0
-- existing rows are outside 'running'/'completed'/'failed'/'cancelled', so
-- widening the CHECK is a no-op against current data).
--
-- Rollback:
--   ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
--   ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check
--     CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));
--   -- (only safe if no 'awaiting_approval' rows exist at rollback time)
--
-- Applied: local only.

BEGIN;

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'awaiting_approval'));

INSERT INTO public.schema_migrations (version) VALUES ('190_agent_runs_awaiting_approval.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

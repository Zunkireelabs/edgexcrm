-- Migration 183: 'claimed' status on ai_write_actions — claim-then-execute
--
-- Phase 5 slice 5.4c-FIXUP (docs/ai-native-efforts). The approval executor
-- (approval-gate.ts) currently checks-then-inserts around executing a write,
-- which leaves a window where a crash between "write executed" and "audit
-- row recorded" would let a retry double-execute the underlying write
-- (e.g. a duplicate task, or worse a duplicate outbound side effect). This
-- migration adds a 'claimed' status so the executor can insert a claim row
-- BEFORE running the write — the UNIQUE (tenant_id, tool_call_id) constraint
-- (mig 173) then makes that insert itself the race-free ownership check,
-- and the write only runs after the claim is won. A row stuck at 'claimed'
-- is the visible symptom of a crash mid-write — surfaced for human
-- follow-up rather than silently duplicated. At-most-once is the chosen
-- tradeoff over at-least-once for customer-data writes: a lost write can be
-- re-approved by a human, a duplicate write cannot be un-sent.
--
-- Additive only — widens an existing CHECK constraint, no data touched.
--
-- Expected before/after row counts: ai_write_actions row count unchanged
-- (0 existing rows can be outside 'executed'/'denied'/'failed', so widening
-- the CHECK is a no-op against current data).
--
-- Rollback:
--   ALTER TABLE public.ai_write_actions DROP CONSTRAINT IF EXISTS ai_write_actions_status_check;
--   ALTER TABLE public.ai_write_actions ADD CONSTRAINT ai_write_actions_status_check
--     CHECK (status IN ('executed', 'denied', 'failed'));
--   -- (only safe if no 'claimed' rows exist at rollback time)
--
-- Applied: local only.

BEGIN;

ALTER TABLE public.ai_write_actions DROP CONSTRAINT IF EXISTS ai_write_actions_status_check;
ALTER TABLE public.ai_write_actions ADD CONSTRAINT ai_write_actions_status_check
  CHECK (status IN ('claimed', 'executed', 'denied', 'failed'));

INSERT INTO public.schema_migrations (version) VALUES ('183_ai_write_actions_claimed_status.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

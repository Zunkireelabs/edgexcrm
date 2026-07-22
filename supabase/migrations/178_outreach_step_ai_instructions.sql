-- Migration 178: Outreach AI-drafting — per-step AI instructions
--
-- Additive: optional per-step AI drafting guidance, used by both the on-demand
-- "Draft with AI" action and (optional) auto-AI steps. Template fields unchanged.
-- Gated by AI_OUTREACH_DRAFT_ENABLED (env) AND tenants.ai_enabled (mig 174) —
-- see src/lib/ai/flag.ts. Stage only; no prod promotion in this brief.
--
-- Expected before/after row counts: 0 rows touched (new nullable column, default NULL).
-- Rollback: ALTER TABLE email_sequence_steps DROP COLUMN IF EXISTS ai_instructions;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.email_sequence_steps
  ADD COLUMN IF NOT EXISTS ai_instructions TEXT;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('178_outreach_step_ai_instructions.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

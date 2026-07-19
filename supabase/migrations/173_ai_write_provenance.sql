-- Migration 173: AI-write provenance on lead_notes and knowledge_base_items
--
-- Phase 4C (docs/ai-native-efforts/working/BRIEF-PHASE-4C-NOTE-AND-KB-WRITES.md).
-- There is no provenance column anywhere in the schema today: lead_notes has
-- user_id/user_email only, knowledge_base_items has created_by only. An
-- AI-written note or KB item is currently indistinguishable from a
-- human-written one — this closes that gap so retrieval (search_knowledge)
-- can mark AI-authored excerpts instead of laundering them as human fact.
--
-- Why tool_call_id and not a FK to ai_write_actions(id): in adapter.ts,
-- execute() runs BEFORE the ai_write_actions insert, so that row's id does
-- not exist yet while the tool is writing. tool_call_id IS known at execute
-- time and ai_write_actions already has UNIQUE (tenant_id, tool_call_id), so
-- it joins cleanly without touching 4A's idempotency/short-circuit insert
-- ordering.
--
-- DEFAULT 'human' means every existing row and every existing insert path
-- (the REST notes/items routes) stays correct with zero code changes.
--
-- Expected before/after row counts: lead_notes and knowledge_base_items row
-- counts unchanged (nullable/defaulted columns added only); all existing
-- rows land as created_via='human'.
--
-- Rollback:
--   ALTER TABLE public.lead_notes DROP CONSTRAINT IF EXISTS lead_notes_created_via_check;
--   ALTER TABLE public.knowledge_base_items DROP CONSTRAINT IF EXISTS kb_items_created_via_check;
--   DROP INDEX IF EXISTS idx_lead_notes_ai_tool_call;
--   DROP INDEX IF EXISTS idx_kb_items_ai_tool_call;
--   ALTER TABLE public.lead_notes DROP COLUMN IF EXISTS created_via;
--   ALTER TABLE public.lead_notes DROP COLUMN IF EXISTS ai_tool_call_id;
--   ALTER TABLE public.knowledge_base_items DROP COLUMN IF EXISTS created_via;
--   ALTER TABLE public.knowledge_base_items DROP COLUMN IF EXISTS ai_tool_call_id;
--
-- Applied: local only (2026-07-19) / stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.lead_notes
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS ai_tool_call_id text;

ALTER TABLE public.knowledge_base_items
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS ai_tool_call_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_notes_created_via_check'
  ) THEN
    ALTER TABLE public.lead_notes
      ADD CONSTRAINT lead_notes_created_via_check CHECK (created_via IN ('human','ai_assistant'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kb_items_created_via_check'
  ) THEN
    ALTER TABLE public.knowledge_base_items
      ADD CONSTRAINT kb_items_created_via_check CHECK (created_via IN ('human','ai_assistant'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_notes_ai_tool_call ON public.lead_notes(ai_tool_call_id) WHERE ai_tool_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kb_items_ai_tool_call  ON public.knowledge_base_items(ai_tool_call_id) WHERE ai_tool_call_id IS NOT NULL;

INSERT INTO public.schema_migrations (version) VALUES ('173_ai_write_provenance.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

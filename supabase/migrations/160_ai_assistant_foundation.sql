-- Migration 160: AI assistant foundation — conversations, messages, usage events
--
-- Phase 1A plumbing (docs/ai-native-efforts/01-PHASE-1-ASSISTANT-FOUNDATION.md).
-- No app code writes to these tables yet — 1A ships zero registered tools and no
-- chat route changes. Tables exist now so 1B's chat route has somewhere to persist.
--
-- ai_conversations: one row per chat thread.
-- ai_messages: one row per turn in a conversation (user/assistant/tool).
-- ai_usage_events: the billing/budget source of truth (not the LLM provider
--   dashboard) — created now, populated in 1B. surface distinguishes assistant
--   chat from future ingestion/background-agent usage (Phase 2/3).
--
-- Tenant isolation: tenant_id FK + RLS (SELECT via get_user_tenant_ids(),
-- mutations via is_tenant_admin(tenant_id)) — mirrors offerings (mig 157).
--
-- Expected before/after row counts: ai_conversations 0 -> 0, ai_messages 0 -> 0,
-- ai_usage_events 0 -> 0 (new tables, no seed).
--
-- Rollback:
--   DROP TABLE IF EXISTS ai_usage_events CASCADE;
--   DROP TABLE IF EXISTS ai_messages CASCADE;
--   DROP TABLE IF EXISTS ai_conversations CASCADE;
--
-- Applied: local only (2026-07-15) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content          JSONB NOT NULL,
  model            TEXT,
  input_tokens     INT,
  output_tokens    INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        UUID,
  agent_id       UUID,
  run_id         TEXT,
  model          TEXT,
  input_tokens   INT,
  output_tokens  INT,
  tool_calls     INT,
  surface        TEXT NOT NULL CHECK (surface IN ('assistant', 'ingestion', 'background_agent')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON ai_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_tenant
  ON ai_usage_events (tenant_id, created_at);

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_conversations_select" ON ai_conversations;
CREATE POLICY "ai_conversations_select" ON ai_conversations
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "ai_conversations_insert" ON ai_conversations;
CREATE POLICY "ai_conversations_insert" ON ai_conversations
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_conversations_update" ON ai_conversations;
CREATE POLICY "ai_conversations_update" ON ai_conversations
  FOR UPDATE USING (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_conversations_delete" ON ai_conversations;
CREATE POLICY "ai_conversations_delete" ON ai_conversations
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "ai_messages_select" ON ai_messages;
CREATE POLICY "ai_messages_select" ON ai_messages
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "ai_messages_insert" ON ai_messages;
CREATE POLICY "ai_messages_insert" ON ai_messages
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_messages_update" ON ai_messages;
CREATE POLICY "ai_messages_update" ON ai_messages
  FOR UPDATE USING (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_messages_delete" ON ai_messages;
CREATE POLICY "ai_messages_delete" ON ai_messages
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "ai_usage_events_select" ON ai_usage_events;
CREATE POLICY "ai_usage_events_select" ON ai_usage_events
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "ai_usage_events_insert" ON ai_usage_events;
CREATE POLICY "ai_usage_events_insert" ON ai_usage_events
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_usage_events_update" ON ai_usage_events;
CREATE POLICY "ai_usage_events_update" ON ai_usage_events
  FOR UPDATE USING (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "ai_usage_events_delete" ON ai_usage_events;
CREATE POLICY "ai_usage_events_delete" ON ai_usage_events
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_ai_conversations_updated_at ON ai_conversations;
CREATE TRIGGER trigger_ai_conversations_updated_at
  BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('160_ai_assistant_foundation.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

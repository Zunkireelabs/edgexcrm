-- Migration 044: Unified Inbox (channel-agnostic omnichannel messaging)
--
-- Three new tables: inbox_channels · conversations · messages
-- Decision A: email tables untouched; 'email' reserved in provider enum
-- Decision B: ai_agent author_type + draft status + ai_metadata + ai_autonomy (seams only)
-- Decision C: RLS allows any tenant member on conversations/messages; admin-only for channel mutations
-- Decision D: contact_phone drives single-match auto-link in API layer (not DB)
--
-- Follows the 3-policy RLS block + update_updated_at() trigger convention from mig 025.

-- ── inbox_channels ────────────────────────────────────────────────────────────
-- One connected messaging account per tenant (WhatsApp phone, Facebook Page, IG account).
-- For sandbox: a generated external_account_id; access_token nullable until real providers land.

CREATE TABLE inbox_channels (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL CHECK (provider IN ('whatsapp', 'messenger', 'instagram', 'sandbox', 'email')),
  external_account_id     TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'disconnected', 'error', 'pending')),
  access_token            TEXT,
  webhook_verify_token_hash TEXT,
  connected_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_error              TEXT,
  meta                    JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anti-spoof: two tenants cannot claim the same Meta account
  CONSTRAINT inbox_channels_provider_account_unique UNIQUE (provider, external_account_id)
);

CREATE INDEX idx_inbox_channels_tenant ON inbox_channels (tenant_id);

CREATE TRIGGER set_inbox_channels_updated_at
  BEFORE UPDATE ON inbox_channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE inbox_channels ENABLE ROW LEVEL SECURITY;

-- Members can VIEW channels (know which channels exist); only admins mutate
CREATE POLICY "Tenant members can view inbox channels"
  ON inbox_channels FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant admins can mutate inbox channels"
  ON inbox_channels FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Service role full access to inbox channels"
  ON inbox_channels FOR ALL
  USING (auth.role() = 'service_role');

-- ── conversations ──────────────────────────────────────────────────────────────
-- One per customer-identity per channel.
-- UNIQUE (channel_id, external_contact_id) is the find-or-create anchor.

CREATE TABLE conversations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id              UUID NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,
  external_contact_id     TEXT NOT NULL,
  contact_phone           TEXT,
  contact_display_name    TEXT,
  last_message_at         TIMESTAMPTZ,
  last_message_preview    TEXT,
  last_message_direction  TEXT CHECK (last_message_direction IN ('inbound', 'outbound')),
  unread_count            INT NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'snoozed')),
  snoozed_until           TIMESTAMPTZ,
  stage_tag               TEXT,
  assignee_type           TEXT NOT NULL DEFAULT 'unassigned' CHECK (assignee_type IN ('unassigned', 'human', 'ai_agent')),
  assigned_to_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_ai_agent_id    UUID,
  lead_id                 UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id              UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ai_autonomy             TEXT NOT NULL DEFAULT 'off' CHECK (ai_autonomy IN ('off', 'suggest', 'autonomous')),
  meta                    JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Find-or-create anchor; implicitly tenant-scoped (channel is tenant-owned)
  CONSTRAINT conversations_channel_contact_unique UNIQUE (channel_id, external_contact_id)
);

CREATE INDEX idx_conversations_tenant_last_msg ON conversations (tenant_id, last_message_at DESC);
CREATE INDEX idx_conversations_tenant_status ON conversations (tenant_id, status, last_message_at DESC);
CREATE INDEX idx_conversations_tenant_assignee ON conversations (tenant_id, assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;
CREATE INDEX idx_conversations_lead ON conversations (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Decision C: any tenant member can view + write conversations (front-line reps work inbox)
CREATE POLICY "Tenant members can manage conversations"
  ON conversations FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Service role full access to conversations"
  ON conversations FOR ALL
  USING (auth.role() = 'service_role');

-- ── messages ───────────────────────────────────────────────────────────────────
-- One row per message (inbound, outbound-human, outbound-ai-draft, system).
-- Partial unique on (channel_id, provider_message_id) WHERE provider_message_id IS NOT NULL
-- ensures webhook redelivery is idempotent; drafts (null provider_message_id) are unconstrained.

CREATE TABLE messages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel_id            UUID NOT NULL REFERENCES inbox_channels(id),
  provider_message_id   TEXT,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  author_type           TEXT NOT NULL CHECK (author_type IN ('customer', 'human_agent', 'ai_agent', 'system')),
  author_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content_text          TEXT,
  attachments           JSONB NOT NULL DEFAULT '[]',
  status                TEXT NOT NULL CHECK (status IN ('draft', 'received', 'queued', 'sent', 'delivered', 'read', 'failed', 'rejected')),
  error                 TEXT,
  ai_metadata           JSONB,
  delivered_at          TIMESTAMPTZ,
  read_at               TIMESTAMPTZ,
  provider_timestamp    TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: webhook redelivery → ON CONFLICT DO NOTHING; drafts unconstrained
CREATE UNIQUE INDEX idx_messages_provider_dedup
  ON messages (channel_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Thread query — ordered by timestamp (provider or created)
CREATE INDEX idx_messages_conversation_ts ON messages (conversation_id, COALESCE(provider_timestamp, created_at));
CREATE INDEX idx_messages_tenant ON messages (tenant_id);
CREATE INDEX idx_messages_draft ON messages (conversation_id)
  WHERE status = 'draft';

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Decision C: any tenant member can manage messages
CREATE POLICY "Tenant members can manage messages"
  ON messages FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Service role full access to messages"
  ON messages FOR ALL
  USING (auth.role() = 'service_role');

-- ── Realtime ─────────────────────────────────────────────────────────────────────
-- The inbox UI subscribes to postgres_changes on `messages` (INSERT/UPDATE) for live
-- threads. That only fires if the table is in the supabase_realtime publication.
-- Guarded: no-op on local Postgres without the publication, or if already a member.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END $$;

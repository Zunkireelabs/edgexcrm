-- Migration 295: per-counselor Chatwoot identity for website-chat replies.
--
-- Additive only: one new table. Each row says "EdgeX user U replies on website-chat channel C
-- as Chatwoot user N, with this (encrypted) API credential", so the visitor's bubble shows the
-- counselor's name instead of one shared name. Created on a counselor's first reply.
--
-- access_token is a CREDENTIAL (AES-256-GCM via src/lib/inbox/crypto.ts, same as
-- inbox_channels.access_token). So, deliberately, there is NO tenant-member policy: only the
-- service role reads or writes this table. It is never exposed to the browser.
--
-- Expected before/after row counts: chatwoot_agent_links: new table, 0 rows.
-- Rollback: DROP TABLE IF EXISTS chatwoot_agent_links;
-- Applied: stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS chatwoot_agent_links (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel_id       UUID NOT NULL REFERENCES inbox_channels(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chatwoot_user_id INTEGER NOT NULL,
  access_token     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chatwoot_agent_links_channel_user_unique UNIQUE (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chatwoot_agent_links_tenant ON chatwoot_agent_links (tenant_id);

DROP TRIGGER IF EXISTS set_chatwoot_agent_links_updated_at ON chatwoot_agent_links;
CREATE TRIGGER set_chatwoot_agent_links_updated_at
  BEFORE UPDATE ON chatwoot_agent_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE chatwoot_agent_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to chatwoot agent links" ON chatwoot_agent_links;
CREATE POLICY "Service role full access to chatwoot agent links"
  ON chatwoot_agent_links FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO public.schema_migrations (version) VALUES ('295_chatwoot_agent_links.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

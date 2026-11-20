-- Migration 294: allow 'chatwoot' as an inbox_channels provider (website chat via a self-hosted Chatwoot).
--
-- Additive only: widens a CHECK constraint, no rows are changed.
-- Expected before/after row counts: inbox_channels: unchanged (0 rows touched).
-- Rollback: DROP the constraint and re-add it without 'chatwoot' (only safe while no
--   inbox_channels row has provider = 'chatwoot'):
--     ALTER TABLE inbox_channels DROP CONSTRAINT IF EXISTS inbox_channels_provider_check;
--     ALTER TABLE inbox_channels ADD CONSTRAINT inbox_channels_provider_check
--       CHECK (provider IN ('whatsapp', 'messenger', 'instagram', 'sandbox', 'email'));
-- Applied: stage HELD / prod HELD.
--
-- conversations.provider is plain TEXT (no CHECK), so no change is needed there.
-- inbox_channels.external_account_id for this provider is "<chatwoot account id>:<chatwoot inbox id>".

BEGIN;

ALTER TABLE inbox_channels DROP CONSTRAINT IF EXISTS inbox_channels_provider_check;
ALTER TABLE inbox_channels ADD CONSTRAINT inbox_channels_provider_check
  CHECK (provider IN ('whatsapp', 'messenger', 'instagram', 'sandbox', 'email', 'chatwoot'));

INSERT INTO public.schema_migrations (version) VALUES ('294_inbox_chatwoot_provider.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

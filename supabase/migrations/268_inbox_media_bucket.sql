-- Migration 268: inbox-media storage bucket
-- Additive only. Creates the private bucket for inbound/outbound WhatsApp
-- (and future provider) message attachments, matching the row already
-- seeded locally in supabase/seed.sql.
--
-- Rollback: DELETE FROM storage.buckets WHERE id = 'inbox-media';
-- (only safe if no objects have been written to it yet).

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('inbox-media', 'inbox-media', false, 20971520)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.schema_migrations (version) VALUES ('268_inbox_media_bucket.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Migration 281: notification_email_log — exactly-once ledger for notification emails (new-lead alert, and any
-- future alert built on src/lib/email/notify).
--
-- One row per (event, entity, recipient). The row is CLAIMED ('pending') before a send and moved to 'sent' only
-- after the provider confirms, so retries / double calls / races cannot send twice (UNIQUE key) and every failure
-- is recorded. Written by the service role only; tenant members may read their own tenant's rows.
--
-- Additive only.
--   Expected before/after row counts: notification_email_log (new table): n/a -> 0 rows. 0 existing rows touched.
--   Rollback: DROP TABLE IF EXISTS public.notification_email_log;  (and delete this file's row from schema_migrations)
--   Applied: stage <YYYY-MM-DD> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_email_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event               TEXT NOT NULL,
  entity_id           UUID NOT NULL,
  recipient_email     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error               TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_email_log_once UNIQUE (event, entity_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_notification_email_log_tenant ON public.notification_email_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_email_log_failed ON public.notification_email_log (tenant_id) WHERE status = 'failed';

ALTER TABLE public.notification_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read notification_email_log" ON public.notification_email_log;
CREATE POLICY "members read notification_email_log" ON public.notification_email_log
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "service all notification_email_log" ON public.notification_email_log;
CREATE POLICY "service all notification_email_log" ON public.notification_email_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.schema_migrations (version) VALUES ('281_notification_email_log.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

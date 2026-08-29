-- Migration 215: tenant_email_settings.mailing_address — sender-identity +
-- physical address line for the compliance footer every outbound email gets.
--
-- Why: injectUnsubscribe() (src/lib/email/outbound/unsubscribe.ts) currently
-- renders only the unsubscribe link. Protecting sending-domain reputation
-- (Resend/ISP spam-complaint risk) calls for a sender/organization name +
-- physical mailing address alongside it, for every tenant, independent of
-- any consent question. Optional/nullable — no tenant is blocked from
-- sending because it hasn't set an address yet; the footer just omits the
-- address line until one is set (per-tenant, from Sadin).
--
-- Additive only. Expected before/after row counts: tenant_email_settings row
-- count unchanged; every existing row gets mailing_address = NULL.
-- Rollback: ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS mailing_address;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE tenant_email_settings
  ADD COLUMN IF NOT EXISTS mailing_address TEXT;

COMMENT ON COLUMN tenant_email_settings.mailing_address IS
  'Physical mailing address shown in the compliance footer of every outbound email '
  '(src/lib/email/outbound/unsubscribe.ts injectUnsubscribe()). Nullable — footer omits '
  'the address line until a tenant sets one.';

DO $$
DECLARE v_total INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM tenant_email_settings;
  RAISE NOTICE '215 tenant_email_settings.mailing_address: % rows now default to NULL', v_total;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('215_email_footer_mailing_address.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

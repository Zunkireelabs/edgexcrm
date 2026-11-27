-- Migration 298: a second company sender ("no-reply") and the colours of the branded one-off email template.
--
-- The lead page's New email pop-up can already send from the verified company address (tenant_email_settings.from_address).
-- This adds, per tenant, an optional second address on the SAME verified domain (e.g. no-reply@mail.admizz.com) whose emails are
-- wrapped in a fixed branded layout (logo header, colour bar, footer), plus the two template colours.
--   no_reply_address  the second sender; NULL = not offered. The app only offers it when it is on the same domain as from_address.
--   template_color    main colour of the layout (#RRGGBB); NULL = fall back to the tenant brand colour.
--   template_accent   small accent tab in the colour bar and the footer link (#RRGGBB); NULL = no accent.
--
-- Additive only: three nullable columns, no row changes. Existing RLS (migration 045) already covers new columns.
-- Expected before/after row counts: tenant_email_settings: 0 rows touched.
-- Rollback: ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS no_reply_address, DROP COLUMN IF EXISTS template_color,
--                                               DROP COLUMN IF EXISTS template_accent;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.tenant_email_settings ADD COLUMN IF NOT EXISTS no_reply_address TEXT;
ALTER TABLE public.tenant_email_settings ADD COLUMN IF NOT EXISTS template_color   TEXT;
ALTER TABLE public.tenant_email_settings ADD COLUMN IF NOT EXISTS template_accent  TEXT;

ALTER TABLE public.tenant_email_settings DROP CONSTRAINT IF EXISTS tenant_email_settings_template_color_check;
ALTER TABLE public.tenant_email_settings
  ADD CONSTRAINT tenant_email_settings_template_color_check
  CHECK (template_color IS NULL OR template_color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.tenant_email_settings DROP CONSTRAINT IF EXISTS tenant_email_settings_template_accent_check;
ALTER TABLE public.tenant_email_settings
  ADD CONSTRAINT tenant_email_settings_template_accent_check
  CHECK (template_accent IS NULL OR template_accent ~ '^#[0-9A-Fa-f]{6}$');

INSERT INTO public.schema_migrations (version) VALUES ('298_email_no_reply_template.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

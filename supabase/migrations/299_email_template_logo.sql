-- Migration 299: the logo shown in the header of the branded no-reply email layout.
--
-- Migration 298 added the no-reply sender and the layout colours. The layout's logo came only from tenants.logo_url, which has no
-- screen to set it, so the header fell back to the company name. This adds one optional per-tenant logo link for the layout.
--   template_logo_url  public https link to a PNG/JPG (not .webp: Outlook does not show it); NULL = fall back to
--                      tenants.logo_url, then to the company name.
--
-- Additive only: one nullable column, no row changes. Existing RLS (migration 045) already covers new columns.
-- Expected before/after row counts: tenant_email_settings: 0 rows touched.
-- Rollback: ALTER TABLE tenant_email_settings DROP COLUMN IF EXISTS template_logo_url;
-- Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE public.tenant_email_settings ADD COLUMN IF NOT EXISTS template_logo_url TEXT;

ALTER TABLE public.tenant_email_settings DROP CONSTRAINT IF EXISTS tenant_email_settings_template_logo_url_check;
ALTER TABLE public.tenant_email_settings
  ADD CONSTRAINT tenant_email_settings_template_logo_url_check
  CHECK (template_logo_url IS NULL OR (template_logo_url ~* '^https://[^[:space:]]+$' AND length(template_logo_url) <= 500));

INSERT INTO public.schema_migrations (version) VALUES ('299_email_template_logo.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

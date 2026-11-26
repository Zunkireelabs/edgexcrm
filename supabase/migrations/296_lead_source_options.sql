-- Migration 296: admin-managed options for the lead Source dropdowns (category / channel / page-account).
--
-- Additive only: one new table. The starting lists live in code (src/lib/leads/source-options.ts); this table
-- holds only what an owner/admin ADDS for their tenant ("+ Add new option" in Edit profile -> Source).
-- Leads keep storing the option's `value` (a slug) in intake_source / intake_medium / intake_account, exactly as
-- today, so no existing lead row changes.
--
-- Expected before/after row counts: lead_source_options: new table, 0 rows.
-- Rollback: DROP TABLE IF EXISTS lead_source_options;
-- Applied: stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lead_source_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('category', 'channel', 'account')),
  value       TEXT NOT NULL,
  label       TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_source_options_unique UNIQUE (tenant_id, kind, value)
);

CREATE INDEX IF NOT EXISTS idx_lead_source_options_tenant_kind
  ON public.lead_source_options (tenant_id, kind);

ALTER TABLE public.lead_source_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view lead source options" ON public.lead_source_options;
CREATE POLICY "Tenant members can view lead source options"
  ON public.lead_source_options FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate lead source options" ON public.lead_source_options;
CREATE POLICY "Tenant admins can mutate lead source options"
  ON public.lead_source_options FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to lead source options" ON public.lead_source_options;
CREATE POLICY "Service role full access to lead source options"
  ON public.lead_source_options FOR ALL
  USING (auth.role() = 'service_role');

INSERT INTO public.schema_migrations (version) VALUES ('296_lead_source_options.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

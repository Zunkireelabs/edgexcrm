-- Migration 157: real_estate — offerings table (capital-raise vehicles)
--
-- An "offering" is a capital-raise vehicle a CRE sponsor markets to investors
-- (e.g. "Industrial Value-Add Fund II"). New tenant-owned table; NOT an
-- extension of `deals` (which is the it_agency revenue object). Investors ride
-- the universal `leads` spine; the connective tissue between an investor (lead)
-- and an offering is `investor_commitments` (mig 158). The per-offering raise
-- funnel is driven by commitment status, not by lead_lists.
--
-- Tenant isolation: tenant_id FK + RLS (SELECT via get_user_tenant_ids(),
-- mutations via is_tenant_admin(tenant_id)) — mirrors project_risks (mig 136).
-- Soft delete: deleted_at; all app queries filter `deleted_at IS NULL`.
--
-- Expected before/after row counts: offerings 0 -> 0 rows (new table, no seed;
-- the demo tenant's offering is seeded by scripts/seed-real-estate-demo.sh, not
-- here — one-time tenant data belongs in scripts/, not a migration).
--
-- Rollback:
--   DROP TABLE IF EXISTS offerings CASCADE;
--
-- Applied: local only (2026-07-15) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS offerings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT,
  asset_class    TEXT,
  structure      TEXT CHECK (structure IN ('single_asset','fund','fund_of_funds','debt')),
  exemption      TEXT CHECK (exemption IN ('506b','506c')),
  target_raise   NUMERIC(16,2),
  min_investment NUMERIC(14,2),
  pref_return    NUMERIC(5,2),
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'raising'
                   CHECK (status IN ('draft','raising','closed','funded','paused')),
  close_date     DATE,
  description    TEXT,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

ALTER TABLE offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offerings_select" ON offerings;
CREATE POLICY "offerings_select" ON offerings
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "offerings_insert" ON offerings;
CREATE POLICY "offerings_insert" ON offerings
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "offerings_update" ON offerings;
CREATE POLICY "offerings_update" ON offerings
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "offerings_delete" ON offerings;
CREATE POLICY "offerings_delete" ON offerings
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_offerings_tenant
  ON offerings (tenant_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trigger_offerings_updated_at ON offerings;
CREATE TRIGGER trigger_offerings_updated_at
  BEFORE UPDATE ON offerings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('157_real_estate_offerings.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

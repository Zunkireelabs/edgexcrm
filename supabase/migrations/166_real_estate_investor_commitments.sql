-- Migration 166: real_estate — investor_commitments (investor <-> offering link)
--
-- The connective tissue of the CRE vertical: one row = one investor's (lead's)
-- position on one offering. Its `status` drives the PER-OFFERING raise funnel
-- (prospect -> soft_commit -> subscribed -> funded; `declined` is off-board).
-- The same investor can be `funded` on one offering and `prospect` on another,
-- which is why the funnel is per-offering here and NOT the global lead_lists.
--
-- Derived values the app computes from this table (nothing is stored):
--   * Equity raised per offering = SUM(amount) WHERE status IN ('subscribed','funded').
--   * Per-investor lifecycle across all offerings: funded>=2 -> Repeat;
--     funded>=1 -> Investor; any soft_commit/subscribed -> Engaged; else Prospect.
--
-- One commitment per investor per offering: enforced by a PARTIAL unique index
-- (UNIQUE constraints can't carry a WHERE clause) so soft-deleted rows don't
-- block re-adding an investor to a raise.
--
-- Tenant isolation: tenant_id FK + RLS (SELECT via get_user_tenant_ids(),
-- mutations via is_tenant_admin(tenant_id)) — mirrors offerings (mig 157).
--
-- Expected before/after row counts: investor_commitments 0 -> 0 rows (new table,
-- no seed; demo commitments seeded by scripts/seed-real-estate-demo.sh).
--
-- Rollback:
--   DROP TABLE IF EXISTS investor_commitments CASCADE;
--
-- Applied: local only (2026-07-15) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS investor_commitments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  offering_id   UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  amount        NUMERIC(14,2),
  status        TEXT NOT NULL DEFAULT 'prospect'
                  CHECK (status IN ('prospect','soft_commit','subscribed','funded','declined')),
  committed_at  TIMESTAMPTZ,
  funded_at     TIMESTAMPTZ,
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

ALTER TABLE investor_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investor_commitments_select" ON investor_commitments;
CREATE POLICY "investor_commitments_select" ON investor_commitments
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "investor_commitments_insert" ON investor_commitments;
CREATE POLICY "investor_commitments_insert" ON investor_commitments
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "investor_commitments_update" ON investor_commitments;
CREATE POLICY "investor_commitments_update" ON investor_commitments
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "investor_commitments_delete" ON investor_commitments;
CREATE POLICY "investor_commitments_delete" ON investor_commitments
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- One live commitment per (investor, offering); soft-deleted rows excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_investor_commitments_lead_offering
  ON investor_commitments (lead_id, offering_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_investor_commitments_tenant_offering
  ON investor_commitments (tenant_id, offering_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_investor_commitments_tenant_lead
  ON investor_commitments (tenant_id, lead_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trigger_investor_commitments_updated_at ON investor_commitments;
CREATE TRIGGER trigger_investor_commitments_updated_at
  BEFORE UPDATE ON investor_commitments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO public.schema_migrations (version) VALUES ('166_real_estate_investor_commitments.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

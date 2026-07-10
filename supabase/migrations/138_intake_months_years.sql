-- Migration 138: Intake Months and Intake Years lookup tables (education_consultancy)
--
-- Replaces the free-text "Intake Term" input on the 3 application screens with
-- two Settings-managed dropdowns (Month, Year), same pattern as migration 124's
-- countries/courses tables. Real production intake_term values are a mess of
-- inconsistent free text ("Sep 2026" / "September" / "SEP-2026" / an Excel date
-- serial / a raw timestamp) — this stops new entries from adding to that pile.
-- Additive + idempotent.
--
--   Expected before/after row counts: intake_months/intake_years 0 -> (12 + N) per
--   education_consultancy tenant (N = current year..current year+9, 10 years).
--   Rollback: DROP TABLE IF EXISTS intake_months; DROP TABLE IF EXISTS intake_years;
--   Applied: stage <PENDING> / prod <PENDING>.

BEGIN;

-- ── intake_months table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intake_months (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  -- Calendar order (1=January..12=December), NOT alphabetical — "April" < "August"
  -- would otherwise sort ahead of "January" in a plain name-based ORDER BY.
  sort_order  INTEGER,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

-- Explicit ADD COLUMN (not just inside CREATE TABLE) so this also lands on a
-- database where intake_months already exists without it — CREATE TABLE IF NOT
-- EXISTS is a full no-op once the table is present, columns and all.
ALTER TABLE intake_months ADD COLUMN IF NOT EXISTS sort_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_intake_months_tenant ON intake_months (tenant_id);

ALTER TABLE intake_months ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_months_select" ON intake_months;
CREATE POLICY "intake_months_select" ON intake_months
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "intake_months_insert" ON intake_months;
CREATE POLICY "intake_months_insert" ON intake_months
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "intake_months_update" ON intake_months;
CREATE POLICY "intake_months_update" ON intake_months
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "intake_months_delete" ON intake_months;
CREATE POLICY "intake_months_delete" ON intake_months
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_intake_months_updated_at ON intake_months;
CREATE TRIGGER trigger_intake_months_updated_at
  BEFORE UPDATE ON intake_months
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── intake_years table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intake_years (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_intake_years_tenant ON intake_years (tenant_id);

ALTER TABLE intake_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intake_years_select" ON intake_years;
CREATE POLICY "intake_years_select" ON intake_years
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "intake_years_insert" ON intake_years;
CREATE POLICY "intake_years_insert" ON intake_years
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "intake_years_update" ON intake_years;
CREATE POLICY "intake_years_update" ON intake_years
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "intake_years_delete" ON intake_years;
CREATE POLICY "intake_years_delete" ON intake_years
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_intake_years_updated_at ON intake_years;
CREATE TRIGGER trigger_intake_years_updated_at
  BEFORE UPDATE ON intake_years
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Seed education_consultancy tenants ──────────────────────────────────────
INSERT INTO intake_months (tenant_id, name, sort_order)
SELECT t.id, m.name, m.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('January', 1), ('February', 2), ('March', 3), ('April', 4),
  ('May', 5), ('June', 6), ('July', 7), ('August', 8),
  ('September', 9), ('October', 10), ('November', 11), ('December', 12)
) AS m(name, sort_order)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order;

-- Current year through +9 years (10 years total), computed at apply-time.
INSERT INTO intake_years (tenant_id, name)
SELECT t.id, y.name
FROM tenants t
CROSS JOIN (
  SELECT (EXTRACT(YEAR FROM CURRENT_DATE)::int + offset_)::text AS name
  FROM generate_series(0, 9) AS offset_
) AS y
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO NOTHING;

DO $$
DECLARE v_months int; v_years int;
BEGIN
  SELECT COUNT(*) INTO v_months FROM intake_months;
  SELECT COUNT(*) INTO v_years FROM intake_years;
  RAISE NOTICE '138 AFTER: % intake_month rows, % intake_year rows', v_months, v_years;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('138_intake_months_years.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

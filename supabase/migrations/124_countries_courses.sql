-- Migration 124: Countries and Courses lookup tables for education_consultancy
-- Allows admins to manage destination countries and fields of study via the
-- Organization settings page. Seeded with current taxonomy data from taxonomies.ts.
-- Additive + idempotent.

BEGIN;

-- ── countries table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS countries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

ALTER TABLE countries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "countries_select" ON countries
  FOR SELECT USING (tenant_id = ANY(get_user_tenant_ids()));
CREATE POLICY "countries_insert" ON countries
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "countries_update" ON countries
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "countries_delete" ON countries
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER countries_updated_at
  BEFORE UPDATE ON countries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── courses table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS courses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "courses_select" ON courses
  FOR SELECT USING (tenant_id = ANY(get_user_tenant_ids()));
CREATE POLICY "courses_insert" ON courses
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "courses_update" ON courses
  FOR UPDATE USING (is_tenant_admin(tenant_id));
CREATE POLICY "courses_delete" ON courses
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER courses_updated_at
  BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Seed education_consultancy tenants ────────────────────────────────────────
DO $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count FROM tenants WHERE industry_id = 'education_consultancy';
  RAISE NOTICE '124: seeding % education_consultancy tenant(s)', v_count;
END$$;

INSERT INTO countries (tenant_id, name)
SELECT t.id, c.name
FROM tenants t
CROSS JOIN (VALUES
  ('UK'), ('Australia'), ('USA'), ('Germany'), ('New Zealand'),
  ('Canada'), ('Finland'), ('India'), ('Nepal'), ('Europe'),
  ('Malta'), ('France'), ('Sweden'), ('Not decided')
) AS c(name)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO courses (tenant_id, name)
SELECT t.id, c.name
FROM tenants t
CROSS JOIN (VALUES
  ('Engineering & Technology'), ('Business & Management'), ('Medical & Pharmacy'),
  ('Allied Health Sciences'), ('Humanities & Social Sciences'),
  ('Law & Legal Studies'), ('Architecture & Design'), ('Applied Sciences'),
  ('Not decided')
) AS c(name)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO NOTHING;

DO $$
DECLARE v_countries int; v_courses int;
BEGIN
  SELECT COUNT(*) INTO v_countries FROM countries;
  SELECT COUNT(*) INTO v_courses FROM courses;
  RAISE NOTICE '124 AFTER: % country rows, % course rows', v_countries, v_courses;
END$$;

COMMIT;

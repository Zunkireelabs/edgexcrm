-- Migration 160: Academic reference catalogs — Interested Study Level + Program
--
-- Additive + idempotent. Wraps DDL + seed in a single transaction.
--   Expected before/after row counts: study_levels/study_programs 0 -> seeded (see RAISE NOTICE).
--   Rollback: DROP TABLE IF EXISTS study_programs; DROP TABLE IF EXISTS study_levels;
--   Applied: stage 2026-07-16 (3 study_levels, 80 study_programs, 61 partner_colleges backfilled) / prod HELD.
--
-- education_consultancy: two new admin-managed reference catalogs.
--   study_levels   — replaces the hardcoded DEGREE_LEVELS constant (Country/Field-of-Study
--                     precedent: countries/courses, migration 124).
--   study_programs — Program tied to a University (partner_colleges), migration 112 precedent.
-- Applications keep storing university_name/program_name as TEXT (migration 057) — no FK
-- added there; these catalogs are separate reference data that feed the dropdowns.

BEGIN;

-- ── study_levels (admin-managed only — no inline create) ───────────────────────
CREATE TABLE IF NOT EXISTS study_levels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INT  NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_study_levels_tenant ON study_levels (tenant_id);

ALTER TABLE study_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "study_levels_select" ON study_levels;
CREATE POLICY "study_levels_select" ON study_levels
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
-- Insert/update/delete admin-only (unlike countries/courses' any-member insert) —
-- Study Level has no inline-create UI, so the write path stays admin-only end to end.
DROP POLICY IF EXISTS "study_levels_insert" ON study_levels;
CREATE POLICY "study_levels_insert" ON study_levels
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "study_levels_update" ON study_levels;
CREATE POLICY "study_levels_update" ON study_levels
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "study_levels_delete" ON study_levels;
CREATE POLICY "study_levels_delete" ON study_levels
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_study_levels_updated_at ON study_levels;
CREATE TRIGGER trigger_study_levels_updated_at
  BEFORE UPDATE ON study_levels FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── study_programs (tied to a University; inline-creatable by any tenant member) ──
CREATE TABLE IF NOT EXISTS study_programs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  university_id UUID NOT NULL REFERENCES partner_colleges(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, university_id, name)
);

CREATE INDEX IF NOT EXISTS idx_study_programs_university ON study_programs (tenant_id, university_id);

ALTER TABLE study_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "study_programs_select" ON study_programs;
CREATE POLICY "study_programs_select" ON study_programs
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
-- Insert mirrors partner_colleges: any tenant member (inline-create path).
DROP POLICY IF EXISTS "study_programs_insert" ON study_programs;
CREATE POLICY "study_programs_insert" ON study_programs
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "study_programs_update" ON study_programs;
CREATE POLICY "study_programs_update" ON study_programs
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
DROP POLICY IF EXISTS "study_programs_delete" ON study_programs;
CREATE POLICY "study_programs_delete" ON study_programs
  FOR DELETE USING (is_tenant_admin(tenant_id));

DROP TRIGGER IF EXISTS trigger_study_programs_updated_at ON study_programs;
CREATE TRIGGER trigger_study_programs_updated_at
  BEFORE UPDATE ON study_programs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Seed: "put everything present in system" ────────────────────────────────────

-- (a) study_levels — seed from the current DEGREE_LEVELS labels (taxonomies.ts), per
--     education tenant. Values, not the UG/PG/PhD short codes — the catalog's `name`
--     column is now both the stored value and the display label going forward.
INSERT INTO study_levels (tenant_id, name, sort_order)
SELECT t.id, v.name, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Undergraduate', 0),
  ('Postgraduate', 1),
  ('Doctor of Philosophy (PhD)', 2)
) AS v(name, sort_order)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, name) DO NOTHING;

-- (b) Backfill partner_colleges (universities) from applications.university_name where
--     a case-insensitive match doesn't already exist — a program needs a parent row.
INSERT INTO partner_colleges (tenant_id, name)
SELECT DISTINCT a.tenant_id, TRIM(a.university_name)
FROM applications a
JOIN tenants t ON t.id = a.tenant_id AND t.industry_id = 'education_consultancy'
WHERE a.deleted_at IS NULL
  AND a.university_name IS NOT NULL AND TRIM(a.university_name) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM partner_colleges pc
    WHERE pc.tenant_id = a.tenant_id AND LOWER(pc.name) = LOWER(TRIM(a.university_name))
  )
ON CONFLICT (tenant_id, name) DO NOTHING;

-- (c) study_programs — seed from existing applications, mapped to the (now-guaranteed)
--     partner_colleges row by case-insensitive university name match.
INSERT INTO study_programs (tenant_id, university_id, name)
SELECT DISTINCT a.tenant_id, pc.id, TRIM(a.program_name)
FROM applications a
JOIN partner_colleges pc
  ON pc.tenant_id = a.tenant_id AND LOWER(pc.name) = LOWER(TRIM(a.university_name))
WHERE a.deleted_at IS NULL
  AND a.program_name IS NOT NULL AND TRIM(a.program_name) <> ''
ON CONFLICT (tenant_id, university_id, name) DO NOTHING;

DO $$
DECLARE v_levels INT; v_programs INT; v_colleges INT;
BEGIN
  SELECT COUNT(*) INTO v_levels FROM study_levels;
  SELECT COUNT(*) INTO v_programs FROM study_programs;
  SELECT COUNT(*) INTO v_colleges FROM partner_colleges;
  RAISE NOTICE '160 AFTER: % study_levels rows, % study_programs rows, % partner_colleges rows (post-backfill)', v_levels, v_programs, v_colleges;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('160_academic_catalogs.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

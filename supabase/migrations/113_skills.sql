-- Migration 113: HRMS Phase 1 — skills catalog + employee_skills
-- Additive only. Seeds starter skill rows for it_agency tenants (dormant elsewhere).
-- Not applied by Sonnet — Opus applies to stage after review (see CLAUDE.md migration workflow).

BEGIN;

-- 1. skills --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_skills_tenant ON skills(tenant_id);

ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "skills_select" ON skills
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "skills_insert" ON skills
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "skills_update" ON skills
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "skills_delete" ON skills
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 2. employee_skills -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_skills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_user_id    UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
  skill_id          UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency       SMALLINT CHECK (proficiency BETWEEN 1 AND 5),
  years             NUMERIC,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_skills_tenant ON employee_skills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_user ON employee_skills(tenant_user_id);
CREATE INDEX IF NOT EXISTS idx_employee_skills_skill ON employee_skills(skill_id);

ALTER TABLE employee_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_skills_select" ON employee_skills
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "employee_skills_insert" ON employee_skills
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "employee_skills_update" ON employee_skills
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "employee_skills_delete" ON employee_skills
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 3. Seed starter skill catalog for existing it_agency tenants, aligned to the
--    Service Catalog categories (mirrors the deal_stages seeding style in 046_deals.sql).
INSERT INTO skills (tenant_id, name, category)
SELECT t.id, s.name, s.category
FROM tenants t
CROSS JOIN (VALUES
  ('React',                'Web Development'),
  ('Node.js',               'Web Development'),
  ('WordPress',             'Web Development'),
  ('React Native',          'Mobile'),
  ('Flutter',               'Mobile'),
  ('iOS (Swift)',           'Mobile'),
  ('Figma',                 'UI/UX'),
  ('User Research',         'UI/UX'),
  ('Design Systems',        'UI/UX'),
  ('AWS',                   'Cloud & DevOps'),
  ('Docker',                'Cloud & DevOps'),
  ('CI/CD',                 'Cloud & DevOps'),
  ('Prompt Engineering',    'AI/ML'),
  ('RAG / Vector Search',   'AI/ML'),
  ('SEO',                   'Digital Marketing'),
  ('Paid Ads',              'Digital Marketing'),
  ('Content Strategy',      'Digital Marketing')
) AS s(name, category)
WHERE t.industry_id = 'it_agency'
ON CONFLICT (tenant_id, name) DO NOTHING;

-- Additive-only: 2 new tables + seed rows scoped to industry_id = 'it_agency' tenants only.
-- Expected before/after: skills 0 -> (17 * count(it_agency tenants)) rows; employee_skills 0 -> 0
-- (attached by users afterwards). No existing table rows modified.

COMMIT;

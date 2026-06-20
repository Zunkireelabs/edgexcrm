-- 059_lead_lists.sql
-- ADDITIVE ONLY — apply manually after review.
-- Introduces lead_lists table (lifecycle segmentation for education_consultancy)
-- and additive columns on leads.
--
-- ROLLBACK (execute manually, in order):
--   ALTER TABLE leads DROP COLUMN IF EXISTS archive_reason;
--   ALTER TABLE leads DROP COLUMN IF EXISTS degree_level;
--   ALTER TABLE leads DROP COLUMN IF EXISTS field_of_study;
--   ALTER TABLE leads DROP COLUMN IF EXISTS destinations;
--   ALTER TABLE leads DROP COLUMN IF EXISTS list_id;
--   DROP TABLE IF EXISTS lead_lists;

-- ── 1. lead_lists table ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lead_lists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  sort_order   INT  NOT NULL DEFAULT 0,
  is_system    BOOLEAN NOT NULL DEFAULT false,
  is_archive   BOOLEAN NOT NULL DEFAULT false,
  is_intake    BOOLEAN NOT NULL DEFAULT false,
  color        TEXT,
  access       JSONB NOT NULL DEFAULT '{"mode":"all"}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_lead_lists_tenant ON lead_lists (tenant_id);

ALTER TABLE lead_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_lists_select" ON lead_lists
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_lists_insert" ON lead_lists
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_lists_update" ON lead_lists
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_lists_delete" ON lead_lists
  FOR DELETE USING (is_tenant_admin(tenant_id) AND is_system = false);

CREATE TRIGGER trigger_lead_lists_updated_at
  BEFORE UPDATE ON lead_lists FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Additive columns on leads ──────────────────────────────────────────────

ALTER TABLE leads ADD COLUMN IF NOT EXISTS list_id       UUID REFERENCES lead_lists(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS destinations  TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS field_of_study TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS degree_level   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_list ON leads (tenant_id, list_id);

-- ── 3. Seed system lists for education_consultancy tenants ────────────────────
-- ON CONFLICT DO NOTHING makes this idempotent on re-apply.

INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_intake, is_archive, access)
SELECT
  t.id,
  v.name,
  v.slug,
  v.sort_order,
  true,
  v.is_intake,
  v.is_archive,
  '{"mode":"all"}'::jsonb
FROM tenants t
CROSS JOIN (VALUES
  ('Pre-qualified', 'pre-qualified', 1, true,  false),
  ('Qualified',     'qualified',     2, false, false),
  ('Prospects',     'prospects',     3, false, false),
  ('Archived',      'archived',      4, false, true)
) AS v(name, slug, sort_order, is_intake, is_archive)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ── 4. Backfill list_id for existing education leads ─────────────────────────
-- Only list_id is written; all other fields are left untouched.
-- Pass 1: leads already marked prospect → Prospects list
-- Pass 2: remaining education leads (list_id still NULL) → Pre-qualified (intake)

UPDATE leads l
SET list_id = ll.id
FROM lead_lists ll
JOIN tenants t ON t.id = l.tenant_id
WHERE ll.tenant_id = l.tenant_id
  AND ll.slug = 'prospects'
  AND l.list_id IS NULL
  AND l.lead_type = 'prospect'
  AND t.industry_id = 'education_consultancy'
  AND l.deleted_at IS NULL;

UPDATE leads l
SET list_id = ll.id
FROM lead_lists ll
JOIN tenants t ON t.id = l.tenant_id
WHERE ll.tenant_id = l.tenant_id
  AND ll.slug = 'pre-qualified'
  AND l.list_id IS NULL
  AND t.industry_id = 'education_consultancy'
  AND l.deleted_at IS NULL;

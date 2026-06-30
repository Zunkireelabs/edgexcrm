-- 090_lead_types.sql
-- Per-tenant configurable list of "Lead Type" options (Student, Parent, B2B, ...).
-- A lead's chosen type is stored as the first element of `leads.tags` (unchanged column).
-- Education_consultancy-scoped feature; other industries get no seed.

CREATE TABLE IF NOT EXISTS lead_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_lead_types_tenant_sort
  ON lead_types (tenant_id, sort_order);

-- Only one default per tenant (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_types_one_default_per_tenant
  ON lead_types (tenant_id) WHERE is_default = true;

ALTER TABLE lead_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_types_select" ON lead_types
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_types_insert" ON lead_types
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_types_update" ON lead_types
  FOR UPDATE USING (is_tenant_admin(tenant_id))
              WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_types_delete" ON lead_types
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- ── Seed Student (default) + Parent for every education_consultancy tenant ──
INSERT INTO lead_types (tenant_id, slug, label, sort_order, is_default)
SELECT t.id, v.slug, v.label, v.sort_order, v.is_default
FROM tenants t
CROSS JOIN (VALUES
  ('student', 'Student', 1, true),
  ('parent',  'Parent',  2, false)
) AS v(slug, label, sort_order, is_default)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

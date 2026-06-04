-- 030_positions.sql
-- Configurable permission profiles ("positions"). Tenant-scoped. Layers on top
-- of tenant_users.role (never replaces it). Education_consultancy tenants get
-- four seeded system positions + a behavioral-no-op backfill of existing members.
-- Other industries seed nothing (engine is universal; defaults are education-only for now).

CREATE TABLE IF NOT EXISTS positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,                                   -- stable key (e.g. 'counselor')
  base_tier   TEXT NOT NULL DEFAULT 'member'
              CHECK (base_tier IN ('owner','admin','member')),
  is_system   BOOLEAN NOT NULL DEFAULT false,                 -- seeded defaults; cannot be deleted
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_positions_tenant ON positions (tenant_id);

ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE invite_tokens
  ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- members read (needed for resolver + invite dropdown); admins mutate; system positions undeletable
CREATE POLICY "positions_select" ON positions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "positions_insert" ON positions
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "positions_update" ON positions
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "positions_delete" ON positions
  FOR DELETE USING (is_tenant_admin(tenant_id) AND is_system = false);

-- ── Seed four system positions for every education_consultancy tenant ──
-- permissions JSONB shape is documented in src/lib/api/permissions.ts (PositionPermissions).
INSERT INTO positions (tenant_id, name, slug, base_tier, is_system, permissions)
SELECT t.id, v.name, v.slug, v.base_tier, true, v.permissions::jsonb
FROM tenants t
CROSS JOIN (VALUES
  ('Owner',     'owner',     'owner',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
  ('Admin',     'admin',     'admin',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"all"}}}'),
  ('Counselor', 'counselor', 'member',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"own","dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}'),
  ('Viewer',    'viewer',    'member',
    '{"nav":{"mode":"all"},"pipelines":{"mode":"all"},"leadScope":"all","dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}')
) AS v(name, slug, base_tier, permissions)
WHERE t.industry_id = 'education_consultancy'
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ── Backfill existing education members to the matching system position ──
-- Maps tenant_users.role → positions.slug. role itself is left UNCHANGED.
-- Counselors MUST land on the 'counselor' (leadScope own) position — this is the
-- one place a bug would silently widen lead access. Verify after applying.
UPDATE tenant_users tu
SET position_id = p.id
FROM positions p, tenants t
WHERE tu.tenant_id = t.id
  AND t.industry_id = 'education_consultancy'
  AND p.tenant_id = tu.tenant_id
  AND p.slug = tu.role        -- role values owner/admin/counselor/viewer == position slugs
  AND tu.position_id IS NULL;
-- Non-education tenants & any unmatched member: position_id stays NULL (resolver derives from role).

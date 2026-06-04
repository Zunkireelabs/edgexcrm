-- 031_org_layers.sql
-- Custom, persistent org-chart layers. Orthogonal to positions.permissions:
-- positions answer "what can you do"; layers answer "where you sit". Human-only.
-- A position belongs to 0 or 1 layer.

CREATE TABLE IF NOT EXISTS org_layers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,   -- 0 = top of the chart
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_layers_tenant ON org_layers (tenant_id, sort_order);

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS layer_id UUID REFERENCES org_layers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_positions_layer ON positions (layer_id);

ALTER TABLE org_layers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_layers_select" ON org_layers
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "org_layers_insert" ON org_layers
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "org_layers_update" ON org_layers
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "org_layers_delete" ON org_layers
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- Seed two default layers for every tenant that already has positions (so the page isn't empty).
INSERT INTO org_layers (tenant_id, name, description, sort_order)
SELECT t.id, v.name, v.description, v.sort_order
FROM tenants t
CROSS JOIN (VALUES
  ('Leadership', 'Owners and administrators', 0),
  ('Team',       'Members and individual contributors', 1)
) AS v(name, description, sort_order)
WHERE EXISTS (SELECT 1 FROM positions p WHERE p.tenant_id = t.id);

-- Assign existing positions: owner/admin base_tier -> Leadership; member -> Team.
UPDATE positions p SET layer_id = l.id
FROM org_layers l
WHERE l.tenant_id = p.tenant_id AND l.name = 'Leadership'
  AND p.base_tier IN ('owner','admin') AND p.layer_id IS NULL;

UPDATE positions p SET layer_id = l.id
FROM org_layers l
WHERE l.tenant_id = p.tenant_id AND l.name = 'Team'
  AND p.base_tier = 'member' AND p.layer_id IS NULL;

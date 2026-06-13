-- 048_dashboards.sql
-- Named, position-scoped dashboards for the Insights surface. Tenant-scoped and
-- universal (engine is industry-agnostic; only the nav/route is education-gated for now).
-- Sharing model: a dashboard is granted to zero+ positions via granted_position_ids.
-- Owner/admin see every dashboard in their tenant; members see only granted ones.

CREATE TABLE IF NOT EXISTS dashboards (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  widgets              JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ordered array of widget keys (strings)
  granted_position_ids UUID[] NOT NULL DEFAULT '{}',         -- positions that may VIEW this dashboard
  sort_order           INT NOT NULL DEFAULT 0,
  created_by           UUID,                                  -- auth.users id; nullable, informational
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON dashboards (tenant_id);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

-- SELECT: admins see all tenant dashboards; members see only those granted to their position.
CREATE POLICY "dashboards_select" ON dashboards
  FOR SELECT USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (
      is_tenant_admin(tenant_id)
      OR EXISTS (
        SELECT 1 FROM tenant_users tu
        WHERE tu.user_id = auth.uid()
          AND tu.tenant_id = dashboards.tenant_id
          AND tu.position_id = ANY (dashboards.granted_position_ids)
      )
    )
  );
CREATE POLICY "dashboards_insert" ON dashboards
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "dashboards_update" ON dashboards
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "dashboards_delete" ON dashboards
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- Seed one "Overview" dashboard per education_consultancy tenant.
-- granted_position_ids = '{}' → only owner/admin see it initially.
-- WHERE NOT EXISTS guard prevents double-insert on re-apply.
INSERT INTO dashboards (tenant_id, name, description, widgets, granted_position_ids, sort_order)
SELECT t.id, 'Overview', 'Default overview dashboard',
       '["stats","leads-by-stage","leads-by-source","leads-by-counselor","utm"]'::jsonb,
       '{}', 0
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
  AND NOT EXISTS (SELECT 1 FROM dashboards d WHERE d.tenant_id = t.id);

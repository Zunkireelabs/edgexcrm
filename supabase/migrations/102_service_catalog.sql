-- 102_service_catalog.sql — it_agency Service Catalog (standalone, flat package)
BEGIN;

CREATE TABLE IF NOT EXISTS services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  hours         NUMERIC(10,2),
  price         NUMERIC(14,2),
  billing_type  TEXT NOT NULL DEFAULT 'fixed' CHECK (billing_type IN ('fixed','hourly','retainer')),
  category      TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_select" ON services
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "services_insert" ON services
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "services_update" ON services
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "services_delete" ON services
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_services_tenant_active
  ON services (tenant_id) WHERE is_active = TRUE;

CREATE TRIGGER trigger_services_updated_at
  BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;

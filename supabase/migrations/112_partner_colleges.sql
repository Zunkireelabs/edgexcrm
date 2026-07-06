-- 112_partner_colleges.sql
-- ADDITIVE ONLY
-- Introduces partner_colleges table for education_consultancy tenants.
-- Colleges managed in Organization settings; used as university dropdown
-- source in application tracking sheets.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS partner_colleges;

CREATE TABLE IF NOT EXISTS partner_colleges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_partner_colleges_tenant ON partner_colleges (tenant_id);

ALTER TABLE partner_colleges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partner_colleges_select" ON partner_colleges
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "partner_colleges_insert" ON partner_colleges
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "partner_colleges_update" ON partner_colleges
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "partner_colleges_delete" ON partner_colleges
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_partner_colleges_updated_at
  BEFORE UPDATE ON partner_colleges FOR EACH ROW EXECUTE FUNCTION update_updated_at();

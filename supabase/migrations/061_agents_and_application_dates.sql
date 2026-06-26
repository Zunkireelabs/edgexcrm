-- 061_agents_and_application_dates.sql
-- ADDITIVE ONLY — apply manually after review (Opus + Sadin GO).
-- Introduces agents table (tenant-managed agent directory) and
-- three additive columns on applications.
--
-- ROLLBACK (execute manually, in order):
--   ALTER TABLE applications DROP COLUMN IF EXISTS intake_start_date;
--   ALTER TABLE applications DROP COLUMN IF EXISTS applied_date;
--   ALTER TABLE applications DROP COLUMN IF EXISTS agent_id;
--   DROP TABLE IF EXISTS agents;

-- ── 1. agents table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  agent_type   TEXT NOT NULL DEFAULT 'agent' CHECK (agent_type IN ('agent', 'super_agent')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents (tenant_id);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_select" ON agents
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "agents_insert" ON agents
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "agents_update" ON agents
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "agents_delete" ON agents
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE TRIGGER trigger_agents_updated_at
  BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Additive columns on applications ───────────────────────────────────────

ALTER TABLE applications ADD COLUMN IF NOT EXISTS agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applied_date       DATE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS intake_start_date  DATE;

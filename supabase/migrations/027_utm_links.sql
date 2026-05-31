-- Saved UTM tracking links per tenant.
-- Lets education-consultancy admins remember every link they built
-- (form picked, source/medium/campaign filled in) so they can copy or
-- delete them later instead of having to rebuild from scratch.
--
-- Records are immutable: admins delete + recreate if they want to change.

CREATE TABLE IF NOT EXISTS utm_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id         UUID REFERENCES form_configs(id) ON DELETE SET NULL,
  destination_url TEXT NOT NULL,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  tracking_url    TEXT NOT NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_utm_links_tenant_created
  ON utm_links (tenant_id, created_at DESC);

ALTER TABLE utm_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utm_links_select" ON utm_links
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "utm_links_insert" ON utm_links
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "utm_links_delete" ON utm_links
  FOR DELETE USING (is_tenant_admin(tenant_id));

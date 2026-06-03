-- 029_knowledge_bases.sql
-- Universal feature: org-level reusable knowledge libraries. Each KB holds
-- items of type file | link | note. Future Orca agents will reference these;
-- embeddings/pgvector are OUT of scope for this migration (future-ready only).
--
-- MANUAL SETUP REQUIRED (not done by this migration — storage buckets are
-- created in Supabase directly, per the 001_initial_schema.sql convention):
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('knowledge-base-files', 'knowledge-base-files', false);
--   -- private bucket, file_size_limit >= 25 MiB, NO anon policies.
--   -- Access is exclusively via service-role signed URLs from admin-gated routes.

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_bases_tenant_created
  ON knowledge_bases (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_base_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('file','link','note')),
  -- future-ready for the embedding pipeline AND drives the UI "Status" column.
  -- v1 always writes 'ready'.
  status            TEXT NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('pending','processing','ready','failed')),
  title             TEXT NOT NULL,
  storage_path      TEXT,    -- file only
  file_name         TEXT,    -- file only (original upload name)
  mime_type         TEXT,    -- file only
  size_bytes        BIGINT,  -- file only (drives rolled-up size)
  url               TEXT,    -- link only
  content           TEXT,    -- note only
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_items_tenant_created
  ON knowledge_base_items (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_items_kb
  ON knowledge_base_items (knowledge_base_id, created_at DESC);

ALTER TABLE knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_items ENABLE ROW LEVEL SECURITY;

-- knowledge_bases: members read, admins mutate
CREATE POLICY "kb_select" ON knowledge_bases
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "kb_insert" ON knowledge_bases
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_update" ON knowledge_bases
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_delete" ON knowledge_bases
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- knowledge_base_items: same convention
CREATE POLICY "kb_items_select" ON knowledge_base_items
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "kb_items_insert" ON knowledge_base_items
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_items_update" ON knowledge_base_items
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "kb_items_delete" ON knowledge_base_items
  FOR DELETE USING (is_tenant_admin(tenant_id));

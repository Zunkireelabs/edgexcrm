-- Migration 161: pgvector + knowledge_chunks (Phase 2A storage seam & schema)
--
-- Phase 2A plumbing (docs/ai-native-efforts/02-PHASE-2-KNOWLEDGE-LAYER.md
-- workstream B / docs/ai-native-efforts/working/BRIEF-PHASE-2A-STORAGE-SEAM-SCHEMA.md).
-- No app code writes to knowledge_chunks yet — ingestion (2B) and retrieval
-- (2C) land in later slices. This creates the chunk-storage table + its
-- HNSW/GIN/tenant indexes, and gives knowledge_base_items (mig 029) the
-- processing-state columns its existing `status` column needs to report on.
--
-- Tenant isolation: tenant_id FK + RLS, SELECT-only via get_user_tenant_ids().
-- Chunk writes are service-role/pipeline-only by design (2B's Inngest
-- ingestion function writes via the service-role client, which bypasses RLS)
-- — no user-facing INSERT/UPDATE/DELETE policy is created here on purpose.
--
-- Expected before/after row counts: knowledge_chunks 0 -> 0 (new table, no
-- seed); knowledge_base_items row count unchanged (three nullable columns
-- added).
--
-- Rollback:
--   ALTER TABLE knowledge_base_items DROP COLUMN IF EXISTS processing_error;
--   ALTER TABLE knowledge_base_items DROP COLUMN IF EXISTS processed_at;
--   ALTER TABLE knowledge_base_items DROP COLUMN IF EXISTS chunk_count;
--   DROP TABLE IF EXISTS knowledge_chunks CASCADE;
--   -- (leaves `CREATE EXTENSION vector` in place — harmless with no dependents once
--   --  the table above is dropped; DROP EXTENSION IF EXISTS vector CASCADE if truly needed.)
--
-- Applied: local only (2026-07-16) / stage HELD / prod HELD.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_item_id      UUID NOT NULL REFERENCES knowledge_base_items(id) ON DELETE CASCADE,
  chunk_index     INT NOT NULL,
  content         TEXT NOT NULL,
  content_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding       VECTOR(1024),
  metadata        JSONB NOT NULL DEFAULT '{}',   -- source, mime, page, section, created_by
  embedding_model TEXT NOT NULL,
  embedding_dim   INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kb_item_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_tsv
  ON knowledge_chunks USING gin (content_tsv);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_item
  ON knowledge_chunks (tenant_id, kb_item_id);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- SELECT only. Ingestion (2B) and any future admin backfill write via the
-- service-role client (bypasses RLS) — intentionally no mutation policy.
DROP POLICY IF EXISTS "knowledge_chunks_select" ON knowledge_chunks;
CREATE POLICY "knowledge_chunks_select" ON knowledge_chunks
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

ALTER TABLE knowledge_base_items ADD COLUMN IF NOT EXISTS processing_error TEXT;
ALTER TABLE knowledge_base_items ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE knowledge_base_items ADD COLUMN IF NOT EXISTS chunk_count INT;

INSERT INTO public.schema_migrations (version) VALUES ('161_knowledge_chunks.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

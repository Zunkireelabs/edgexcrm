-- Migration 231: Applicant Document Intelligence, Phase 1 — schema
--
-- Brand-new, fully separate system for applicant (lead) documents — passport,
-- transcripts, marksheets, certificates, CV, recommendation letters, bank
-- statements, English test results, offer letters, visa docs, other ID.
-- Storage is Cloudflare R2 (src/lib/documents/storage/), not Supabase
-- Storage. This migration does NOT touch, extend, or reference the existing
-- knowledge-base feature (knowledge_bases / knowledge_base_items /
-- knowledge_chunks, migrations 029/169/170) — different tables, different
-- bucket, different pipeline. See docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md.
--
-- 6 new tables + 1 RPC, all additive. applicant_document_chunks and
-- applicant_document_extractions are created now but stay EMPTY until a
-- later phase wires the ingestion pipeline — nothing in this phase writes to
-- them. applicant_document_hybrid_search is created empty-but-correct
-- (cloned from knowledge_hybrid_search's RRF shape, migration 170) and is not
-- called from any application code yet.
--
-- Circular FK: applicant_documents.current_version_id references
-- applicant_document_versions, which itself references applicant_documents.
-- Resolved by creating applicant_documents WITHOUT that column first, then
-- applicant_document_versions, then ALTER TABLE to add the column.
--
-- RLS is NOT uniformly admin-gated: INSERT/UPDATE on applicant_documents and
-- applicant_document_versions is open to any tenant member (document upload
-- is routine counselor work) — the real authorization (can this counselor
-- touch THIS lead's documents) is enforced at the API layer via canViewLead,
-- not RLS. DELETE on applicant_documents is restricted to is_tenant_admin()
-- or the original uploaded_by user. applicant_document_chunks and
-- applicant_document_extractions are SELECT-only via RLS — writes are
-- service-role/pipeline-only (identical convention to knowledge_chunks).
-- document_usage_events is an internal ledger: SELECT is_tenant_admin() only,
-- no authenticated-role INSERT policy (written via the service-role client
-- from API routes only).
--
-- Expected before/after row counts: all 6 tables are brand new — 0 -> 0 on
-- every one (no seed/backfill in this migration).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS applicant_document_hybrid_search(uuid, uuid, vector(1024), text, int);
--   DROP TABLE IF EXISTS document_usage_events;
--   DROP TABLE IF EXISTS tenant_document_settings;
--   DROP TABLE IF EXISTS applicant_document_extractions;
--   DROP TABLE IF EXISTS applicant_document_chunks;
--   ALTER TABLE applicant_documents DROP COLUMN IF EXISTS current_version_id;
--   DROP TABLE IF EXISTS applicant_document_versions;
--   DROP TABLE IF EXISTS applicant_documents;
--
-- Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- ── applicant_documents (without current_version_id — see circular-FK note) ────

CREATE TABLE IF NOT EXISTS applicant_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id              UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  document_type        TEXT NOT NULL CHECK (document_type IN (
    'passport', 'marksheet', 'transcript', 'certificate', 'cv', 'recommendation_letter',
    'financial_document', 'bank_statement', 'english_test_result', 'offer_letter',
    'visa_document', 'identity_document', 'other'
  )),
  name                 TEXT NOT NULL,
  original_filename    TEXT NOT NULL,
  mime_type            TEXT NOT NULL,
  file_size            BIGINT NOT NULL,
  storage_provider     TEXT NOT NULL DEFAULT 'r2',
  status               TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'queued', 'processing', 'ready', 'failed')),
  processing_error     TEXT,
  processed_at         TIMESTAMPTZ,
  chunk_count          INT,
  verification_status  TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  description          TEXT,
  uploaded_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_applicant_documents_tenant_lead
  ON applicant_documents (tenant_id, lead_id);

CREATE INDEX IF NOT EXISTS idx_applicant_documents_lead_deleted
  ON applicant_documents (lead_id) WHERE deleted_at IS NULL;

-- ── applicant_document_versions ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applicant_document_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number  INT NOT NULL,
  storage_key     TEXT NOT NULL,
  file_size       BIGINT NOT NULL,
  checksum        TEXT NOT NULL, -- sha256
  mime_type       TEXT NOT NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_applicant_document_versions_document
  ON applicant_document_versions (document_id);

-- Now that applicant_document_versions exists, close the circular FK.
ALTER TABLE applicant_documents
  ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES applicant_document_versions(id);

-- ── applicant_document_chunks (empty until a later phase wires ingestion) ──────

CREATE TABLE IF NOT EXISTS applicant_document_chunks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  document_id           UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
  document_version_id   UUID NOT NULL REFERENCES applicant_document_versions(id) ON DELETE CASCADE,
  chunk_index           INT NOT NULL,
  content               TEXT NOT NULL,
  content_tsv           TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding             VECTOR(1024),
  page_number           INT,
  metadata              JSONB NOT NULL DEFAULT '{}',
  embedding_model       TEXT,
  embedding_dim         INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_applicant_document_chunks_embedding_hnsw
  ON applicant_document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_applicant_document_chunks_content_tsv
  ON applicant_document_chunks USING gin (content_tsv);

CREATE INDEX IF NOT EXISTS idx_applicant_document_chunks_tenant_lead
  ON applicant_document_chunks (tenant_id, lead_id);

-- ── applicant_document_extractions (empty until a later phase wires extraction) ─

CREATE TABLE IF NOT EXISTS applicant_document_extractions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID NOT NULL REFERENCES applicant_documents(id) ON DELETE CASCADE,
  document_version_id   UUID NOT NULL REFERENCES applicant_document_versions(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  extraction_type       TEXT NOT NULL,
  raw_text              TEXT,
  structured_data       JSONB,
  confidence            NUMERIC,
  model                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applicant_document_extractions_document
  ON applicant_document_extractions (document_id);

CREATE INDEX IF NOT EXISTS idx_applicant_document_extractions_tenant_lead
  ON applicant_document_extractions (tenant_id, lead_id);

-- ── tenant_document_settings (mirrors tenant_sms_settings, migration 202) ──────
-- No row is required per tenant — the API layer reads this with sane defaults
-- (25MB cap etc.) when no row exists. Phase 1 only creates the table; a
-- settings UI is a later phase.

CREATE TABLE IF NOT EXISTS tenant_document_settings (
  tenant_id                  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_storage_bytes          BIGINT,
  max_document_size_mb       INT NOT NULL DEFAULT 25,
  max_documents_per_lead     INT,
  max_ocr_pages_per_month    INT,
  required_document_types    TEXT[] NOT NULL DEFAULT '{}',
  retention_days             INT, -- null = keep forever
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ── document_usage_events (append-only ledger, mirrors sms_credit_ledger) ──────
-- No mutable balance/counter table — usage is derived via SUM at read time.

CREATE TABLE IF NOT EXISTS document_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'upload', 'download', 'view', 'delete', 'ocr_page', 'embedding_batch', 'ai_query'
  )),
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  quantity        NUMERIC NOT NULL DEFAULT 1,
  unit            TEXT,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_usage_events_tenant_time
  ON document_usage_events (tenant_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE applicant_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applicant_documents_select" ON applicant_documents;
CREATE POLICY "applicant_documents_select" ON applicant_documents
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Any tenant member may upload/edit — routine counselor work. Real
-- per-lead authorization (canViewLead) is enforced at the API layer, not here.
DROP POLICY IF EXISTS "applicant_documents_insert" ON applicant_documents;
CREATE POLICY "applicant_documents_insert" ON applicant_documents
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "applicant_documents_update" ON applicant_documents;
CREATE POLICY "applicant_documents_update" ON applicant_documents
  FOR UPDATE
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

-- DELETE restricted to a tenant admin or the original uploader.
DROP POLICY IF EXISTS "applicant_documents_delete" ON applicant_documents;
CREATE POLICY "applicant_documents_delete" ON applicant_documents
  FOR DELETE USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (is_tenant_admin(tenant_id) OR uploaded_by = auth.uid())
  );

DROP POLICY IF EXISTS "Service role full access to applicant_documents" ON applicant_documents;
CREATE POLICY "Service role full access to applicant_documents" ON applicant_documents
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE applicant_document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applicant_document_versions_select" ON applicant_document_versions;
CREATE POLICY "applicant_document_versions_select" ON applicant_document_versions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "applicant_document_versions_insert" ON applicant_document_versions;
CREATE POLICY "applicant_document_versions_insert" ON applicant_document_versions
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "applicant_document_versions_update" ON applicant_document_versions;
CREATE POLICY "applicant_document_versions_update" ON applicant_document_versions
  FOR UPDATE
  USING (tenant_id IN (SELECT get_user_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to applicant_document_versions" ON applicant_document_versions;
CREATE POLICY "Service role full access to applicant_document_versions" ON applicant_document_versions
  FOR ALL USING (auth.role() = 'service_role');

-- SELECT-only. Writes are service-role/pipeline-only (identical convention to
-- knowledge_chunks, migration 169) — no user-facing INSERT/UPDATE/DELETE policy.
ALTER TABLE applicant_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applicant_document_chunks_select" ON applicant_document_chunks;
CREATE POLICY "applicant_document_chunks_select" ON applicant_document_chunks
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to applicant_document_chunks" ON applicant_document_chunks;
CREATE POLICY "Service role full access to applicant_document_chunks" ON applicant_document_chunks
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE applicant_document_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "applicant_document_extractions_select" ON applicant_document_extractions;
CREATE POLICY "applicant_document_extractions_select" ON applicant_document_extractions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Service role full access to applicant_document_extractions" ON applicant_document_extractions;
CREATE POLICY "Service role full access to applicant_document_extractions" ON applicant_document_extractions
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE tenant_document_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view document settings" ON tenant_document_settings;
CREATE POLICY "Tenant members can view document settings" ON tenant_document_settings
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate document settings" ON tenant_document_settings;
CREATE POLICY "Tenant admins can mutate document settings" ON tenant_document_settings
  FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to tenant_document_settings" ON tenant_document_settings;
CREATE POLICY "Service role full access to tenant_document_settings" ON tenant_document_settings
  FOR ALL USING (auth.role() = 'service_role');

-- Internal ledger, not a user-facing feed. SELECT tenant-admin only; no
-- authenticated-role INSERT policy — written by the service-role client from
-- API routes only.
ALTER TABLE document_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant admins can view document usage events" ON document_usage_events;
CREATE POLICY "Tenant admins can view document usage events" ON document_usage_events
  FOR SELECT USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to document_usage_events" ON document_usage_events;
CREATE POLICY "Service role full access to document_usage_events" ON document_usage_events
  FOR ALL USING (auth.role() = 'service_role');

-- ── RPC: applicant_document_hybrid_search ───────────────────────────────────
-- Clone of knowledge_hybrid_search's RRF shape (migration 170), scoped by
-- BOTH tenant and lead. Empty-but-correct: applicant_document_chunks has zero
-- rows in this phase, so this returns zero results until a later phase wires
-- ingestion — created now, called by nothing yet.
--
-- Trust model identical to knowledge_hybrid_search: p_tenant_id/p_lead_id are
-- PARAMETERS trusted from the caller (always the service-role client, via an
-- app-layer canViewLead check first) — never RLS/session-derived. Must never
-- be callable by authenticated/anon.

CREATE OR REPLACE FUNCTION applicant_document_hybrid_search(
  p_tenant_id UUID,
  p_lead_id UUID,
  p_query_embedding VECTOR(1024),
  p_query TEXT,
  p_limit INT DEFAULT 12
) RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  document_version_id UUID,
  chunk_index INT,
  content TEXT,
  page_number INT,
  metadata JSONB,
  rrf_score FLOAT
)
LANGUAGE sql
STABLE
AS $$
  WITH vector_arm AS (
    SELECT
      id,
      row_number() OVER (ORDER BY embedding <=> p_query_embedding) AS rank
    FROM applicant_document_chunks
    WHERE tenant_id = p_tenant_id
      AND lead_id = p_lead_id
      AND embedding IS NOT NULL
    ORDER BY embedding <=> p_query_embedding
    LIMIT 24
  ),
  keyword_arm AS (
    SELECT
      id,
      row_number() OVER (ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', p_query)) DESC) AS rank
    FROM applicant_document_chunks
    WHERE tenant_id = p_tenant_id
      AND lead_id = p_lead_id
      AND content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY ts_rank(content_tsv, websearch_to_tsquery('english', p_query)) DESC
    LIMIT 24
  ),
  fused AS (
    SELECT
      id,
      sum(1.0 / (60 + rank)) AS rrf_score
    FROM (
      SELECT id, rank FROM vector_arm
      UNION ALL
      SELECT id, rank FROM keyword_arm
    ) arms
    GROUP BY id
  )
  SELECT
    c.id AS chunk_id,
    c.document_id,
    c.document_version_id,
    c.chunk_index,
    c.content,
    c.page_number,
    c.metadata,
    f.rrf_score
  FROM fused f
  JOIN applicant_document_chunks c ON c.id = f.id
  ORDER BY f.rrf_score DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION applicant_document_hybrid_search(uuid, uuid, vector(1024), text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION applicant_document_hybrid_search(uuid, uuid, vector(1024), text, int) FROM anon;
REVOKE ALL ON FUNCTION applicant_document_hybrid_search(uuid, uuid, vector(1024), text, int) FROM authenticated;
-- No GRANT to service_role needed — Supabase's ALTER DEFAULT PRIVILEGES
-- already grants EXECUTE on new public-schema functions to service_role
-- (see migration 170's identical note).

INSERT INTO public.schema_migrations (version) VALUES ('231_applicant_documents.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

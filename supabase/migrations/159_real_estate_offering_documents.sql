-- Migration 159: real_estate — offering_documents table (per-offering data room)
--
-- A "data room" is the per-offering document vault a CRE sponsor exposes to
-- investors (PPM, Operating Agreement, financials, other). New tenant-owned
-- table, scoped to an offering (mig 157). Files live in the existing
-- `lead-documents` storage bucket (reused via the presigned /api/v1/upload
-- route); this table only records metadata + the object key (storage_path).
--
-- Tenant isolation: tenant_id FK + RLS (SELECT via get_user_tenant_ids(),
-- mutations via is_tenant_admin(tenant_id)) — mirrors offerings (mig 157).
-- Soft delete: deleted_at; all app queries filter `deleted_at IS NULL`.
--
-- Expected before/after row counts: offering_documents 0 -> 0 rows (new table,
-- no seed; any demo rows are added by scripts/seed-real-estate-demo.sh, not here).
--
-- Rollback:
--   DROP TABLE IF EXISTS offering_documents CASCADE;
--
-- Applied: local only (2026-07-15) / stage HELD / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS offering_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  offering_id   UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  storage_path  TEXT NOT NULL,                 -- object key in the lead-documents bucket
  content_type  TEXT,
  size_bytes    BIGINT,
  doc_type      TEXT CHECK (doc_type IN ('ppm','operating_agreement','financials','other')),
  uploaded_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

ALTER TABLE offering_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offering_documents_select" ON offering_documents;
CREATE POLICY "offering_documents_select" ON offering_documents
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "offering_documents_insert" ON offering_documents;
CREATE POLICY "offering_documents_insert" ON offering_documents
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "offering_documents_update" ON offering_documents;
CREATE POLICY "offering_documents_update" ON offering_documents
  FOR UPDATE USING (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "offering_documents_delete" ON offering_documents;
CREATE POLICY "offering_documents_delete" ON offering_documents
  FOR DELETE USING (is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_offering_documents_tenant_offering
  ON offering_documents (tenant_id, offering_id) WHERE deleted_at IS NULL;

INSERT INTO public.schema_migrations (version) VALUES ('159_real_estate_offering_documents.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

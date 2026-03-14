-- Migration: 007_integration_permissions
-- Purpose: Scope-based permissions for integration keys + idempotency tracking
-- Date: 2026-02-22

-- Rename existing jsonb permissions to permissions_detail (preserved, not removed)
ALTER TABLE integration_keys RENAME COLUMN permissions TO permissions_detail;

-- Add scope-based permissions as text array
ALTER TABLE integration_keys
ADD COLUMN permissions text[] NOT NULL DEFAULT '{read,write}';

-- GIN index for array containment checks
CREATE INDEX IF NOT EXISTS idx_integration_keys_permissions
ON integration_keys USING gin (permissions);

-- Idempotency tracking for integration mutations (assign, move-stage)
CREATE TABLE IF NOT EXISTS integration_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  endpoint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Unique constraint: one key per tenant
ALTER TABLE integration_idempotency
ADD CONSTRAINT uq_integration_idempotency
UNIQUE (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_integration_idempotency_tenant_key
ON integration_idempotency (tenant_id, idempotency_key);

-- RLS
ALTER TABLE integration_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct access"
ON integration_idempotency FOR ALL USING (false);

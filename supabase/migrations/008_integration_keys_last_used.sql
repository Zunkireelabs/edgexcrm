-- Migration: 008_integration_keys_last_used
-- Purpose: Add last_used_at tracking + performance indexes for API key management
-- Date: 2026-03-01

-- Add last_used_at column for tracking key usage
ALTER TABLE integration_keys
ADD COLUMN IF NOT EXISTS last_used_at timestamptz NULL;

-- Composite index for tenant key listing (active + revoked, ordered by created_at)
CREATE INDEX IF NOT EXISTS idx_integration_keys_tenant_revoked
ON integration_keys (tenant_id, revoked_at);

-- Index for last_used_at (used in throttle check and display sorting)
CREATE INDEX IF NOT EXISTS idx_integration_keys_last_used
ON integration_keys (last_used_at)
WHERE last_used_at IS NOT NULL;

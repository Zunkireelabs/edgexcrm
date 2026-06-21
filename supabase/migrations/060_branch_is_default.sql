-- Migration 060: branches.is_default — one default branch per tenant
-- Additive + idempotent. DO NOT APPLY until Opus reviews the KTM seed match.
-- Rollback: DROP INDEX IF EXISTS uniq_branches_default_per_tenant;
--           ALTER TABLE branches DROP COLUMN IF EXISTS is_default;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- Enforce at most one default per tenant at the index level.
-- Partial unique index on (tenant_id) WHERE is_default = true.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_branches_default_per_tenant
  ON branches(tenant_id)
  WHERE is_default = true;

-- Seed: mark Admizz's KTM branch as the tenant default.
-- Matches by tenant slug 'admizz' + branch name/slug prefix 'ktm'.
-- Opus to verify the match resolves to exactly one row before applying.
UPDATE branches
SET is_default = true
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'admizz' LIMIT 1)
  AND (name ILIKE 'ktm%' OR slug ILIKE 'ktm%');

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter','professional','enterprise')),
  ADD COLUMN IF NOT EXISTS entitlement_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Migration: Multi-Pipeline Support
-- ===================================
-- Allows tenants to have multiple pipelines, each with independent stages.

-- 1. Create pipelines table
-- ==========================
CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pipelines_tenant_id ON pipelines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_is_default ON pipelines(tenant_id, is_default) WHERE is_default = true;

-- Trigger for updated_at
CREATE TRIGGER trigger_pipelines_updated_at
  BEFORE UPDATE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. RLS Policies for pipelines
-- ==============================
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view pipelines" ON pipelines
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can insert pipelines" ON pipelines
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Admins can update pipelines" ON pipelines
  FOR UPDATE USING (is_tenant_admin(tenant_id));

CREATE POLICY "Admins can delete pipelines" ON pipelines
  FOR DELETE USING (is_tenant_admin(tenant_id));

-- 3. Add pipeline_id to pipeline_stages
-- ======================================
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE;

-- Add terminal_type to distinguish won vs lost
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS terminal_type VARCHAR(10) CHECK (terminal_type IN ('won', 'lost'));

-- Index for pipeline lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_id ON pipeline_stages(pipeline_id);

-- 4. Add pipeline_id to leads
-- ============================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id);

-- Index for pipeline filtering
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_id ON leads(pipeline_id);

-- 5. Data Migration: Create default pipeline for each tenant
-- ===========================================================
INSERT INTO pipelines (tenant_id, name, slug, is_default, position)
SELECT id, 'Default Pipeline', 'default', true, 0
FROM tenants
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- 6. Link existing stages to the default pipeline
-- ================================================
UPDATE pipeline_stages ps
SET pipeline_id = p.id
FROM pipelines p
WHERE ps.tenant_id = p.tenant_id
  AND p.is_default = true
  AND ps.pipeline_id IS NULL;

-- 7. Link existing leads to the default pipeline
-- ===============================================
UPDATE leads l
SET pipeline_id = p.id
FROM pipelines p
WHERE l.tenant_id = p.tenant_id
  AND p.is_default = true
  AND l.pipeline_id IS NULL;

-- 8. Set terminal_type based on existing is_terminal and common slug patterns
-- ============================================================================
UPDATE pipeline_stages
SET terminal_type = CASE
  WHEN slug IN ('won', 'enrolled', 'hired', 'closed-won', 'converted', 'active') THEN 'won'
  WHEN slug IN ('lost', 'rejected', 'closed-lost', 'withdrawn', 'cancelled') THEN 'lost'
  WHEN is_terminal = true AND terminal_type IS NULL THEN 'lost'  -- Default unknown terminals to lost
  ELSE NULL
END
WHERE is_terminal = true AND terminal_type IS NULL;

-- 9. Update unique constraint on pipeline_stages
-- ===============================================
-- Drop old unique constraint (slug per tenant)
ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_tenant_id_slug_key;

-- Add new unique constraint (slug per pipeline)
-- Note: Only add if pipeline_id is populated
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_pipeline_id_slug_key'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_pipeline_id_slug_key UNIQUE(pipeline_id, slug);
  END IF;
END $$;

-- 10. Make pipeline_id NOT NULL after data migration
-- ===================================================
-- Only set NOT NULL if all rows have pipeline_id populated
DO $$
BEGIN
  -- Check if any stages are missing pipeline_id
  IF NOT EXISTS (SELECT 1 FROM pipeline_stages WHERE pipeline_id IS NULL) THEN
    ALTER TABLE pipeline_stages ALTER COLUMN pipeline_id SET NOT NULL;
  END IF;

  -- Check if any leads are missing pipeline_id
  IF NOT EXISTS (SELECT 1 FROM leads WHERE pipeline_id IS NULL) THEN
    ALTER TABLE leads ALTER COLUMN pipeline_id SET NOT NULL;
  END IF;
END $$;

-- 11. Function to ensure only one default pipeline per tenant
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_single_default_pipeline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE pipelines
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ensure_single_default_pipeline
  BEFORE INSERT OR UPDATE OF is_default ON pipelines
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_pipeline();

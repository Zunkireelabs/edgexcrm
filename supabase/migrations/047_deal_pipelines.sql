-- Migration 047: Deal Pipelines (multiple configurable deal pipelines)
-- Additive + idempotent. Apply to LOCAL DB only — Opus applies to shared DB after review.

-- ============================================================
-- 1. deal_pipelines table (mirrors pipelines from 016)
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  position INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_deal_pipelines_tenant ON deal_pipelines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_deal_pipelines_tenant_default
  ON deal_pipelines(tenant_id, is_default) WHERE is_default = true;

ALTER TABLE deal_pipelines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deal_pipelines' AND policyname = 'deal_pipelines_select') THEN
    CREATE POLICY "deal_pipelines_select" ON deal_pipelines
      FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deal_pipelines' AND policyname = 'deal_pipelines_insert') THEN
    CREATE POLICY "deal_pipelines_insert" ON deal_pipelines
      FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deal_pipelines' AND policyname = 'deal_pipelines_update') THEN
    CREATE POLICY "deal_pipelines_update" ON deal_pipelines
      FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deal_pipelines' AND policyname = 'deal_pipelines_delete') THEN
    CREATE POLICY "deal_pipelines_delete" ON deal_pipelines
      FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_deal_pipelines_updated_at'
  ) THEN
    CREATE TRIGGER trigger_deal_pipelines_updated_at
      BEFORE UPDATE ON deal_pipelines FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. Single-default trigger for deal_pipelines
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_single_default_deal_pipeline()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE deal_pipelines
    SET is_default = false
    WHERE tenant_id = NEW.tenant_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_ensure_single_default_deal_pipeline'
  ) THEN
    CREATE TRIGGER trigger_ensure_single_default_deal_pipeline
      BEFORE INSERT OR UPDATE OF is_default ON deal_pipelines
      FOR EACH ROW
      WHEN (NEW.is_default = true)
      EXECUTE FUNCTION ensure_single_default_deal_pipeline();
  END IF;
END $$;

-- ============================================================
-- 3. Add pipeline_id columns (nullable for now)
-- ============================================================
ALTER TABLE deal_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES deal_pipelines(id) ON DELETE CASCADE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES deal_pipelines(id);

CREATE INDEX IF NOT EXISTS idx_deal_stages_pipeline ON deal_stages(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_tenant_pipeline
  ON deals(tenant_id, pipeline_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 4. Backfill: create default pipeline for tenants with existing deal_stages
-- ============================================================
INSERT INTO deal_pipelines (tenant_id, name, slug, is_default, position)
SELECT DISTINCT tenant_id, 'Sales Pipeline', 'sales-pipeline', true, 0
FROM deal_stages
ON CONFLICT (tenant_id, slug) DO NOTHING;

UPDATE deal_stages ds SET pipeline_id = dp.id
FROM deal_pipelines dp
WHERE dp.tenant_id = ds.tenant_id AND dp.is_default = true AND ds.pipeline_id IS NULL;

UPDATE deals d SET pipeline_id = dp.id
FROM deal_pipelines dp
WHERE dp.tenant_id = d.tenant_id AND dp.is_default = true AND d.pipeline_id IS NULL;

-- ============================================================
-- 5. Swap deal_stages uniqueness from per-tenant to per-pipeline
-- ============================================================
ALTER TABLE deal_stages DROP CONSTRAINT IF EXISTS deal_stages_tenant_id_slug_key;
ALTER TABLE deal_stages ADD CONSTRAINT IF NOT EXISTS deal_stages_pipeline_slug_key UNIQUE (pipeline_id, slug);

-- ============================================================
-- 6. Enforce NOT NULL on deal_stages.pipeline_id after backfill
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deal_stages' AND column_name = 'pipeline_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE deal_stages ALTER COLUMN pipeline_id SET NOT NULL;
  END IF;
END $$;

-- Migration: Lead Insights for AI Scoring
-- Description: Creates lead_insights table for persisting AI-generated insights
-- and adds scoring columns to leads table for quick filtering/sorting

-- ============================================================================
-- PART 1: Create lead_insights table
-- ============================================================================

CREATE TABLE lead_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Score (0-100)
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  score_label TEXT NOT NULL CHECK (score_label IN ('High', 'Medium', 'Low')),
  priority_tier TEXT NOT NULL CHECK (priority_tier IN ('hot', 'warm', 'cold', 'unlikely')),

  -- Factors (explainability) - array of {label, impact, points}
  factors JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Generated content
  summary TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  engagement JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Cache control
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One insight record per lead
  UNIQUE(lead_id)
);

-- Add comment
COMMENT ON TABLE lead_insights IS 'Cached AI-generated insights for leads with 24-hour TTL';

-- ============================================================================
-- PART 2: Create indexes
-- ============================================================================

CREATE INDEX idx_lead_insights_tenant ON lead_insights(tenant_id);
CREATE INDEX idx_lead_insights_lead ON lead_insights(lead_id);
CREATE INDEX idx_lead_insights_expires ON lead_insights(expires_at);
CREATE INDEX idx_lead_insights_score ON lead_insights(tenant_id, score DESC);
CREATE INDEX idx_lead_insights_priority ON lead_insights(tenant_id, priority_tier);

-- ============================================================================
-- PART 3: Add trigger for updated_at
-- ============================================================================

CREATE TRIGGER update_lead_insights_updated_at
  BEFORE UPDATE ON lead_insights
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- PART 4: Enable RLS
-- ============================================================================

ALTER TABLE lead_insights ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see insights for leads in their tenant
CREATE POLICY "Tenant isolation for lead_insights"
  ON lead_insights FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- ============================================================================
-- PART 5: Add scoring columns to leads table
-- ============================================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_priority TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_score_updated_at TIMESTAMPTZ;

-- Add check constraint for ai_score
ALTER TABLE leads ADD CONSTRAINT leads_ai_score_check
  CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100));

-- Add check constraint for ai_priority
ALTER TABLE leads ADD CONSTRAINT leads_ai_priority_check
  CHECK (ai_priority IS NULL OR ai_priority IN ('hot', 'warm', 'cold', 'unlikely'));

-- Index for sorting/filtering by score
CREATE INDEX idx_leads_ai_score ON leads(tenant_id, ai_score DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_leads_ai_priority ON leads(tenant_id, ai_priority)
  WHERE deleted_at IS NULL AND ai_priority IS NOT NULL;

-- ============================================================================
-- PART 6: Grant permissions
-- ============================================================================

-- Service role has full access (for API operations)
GRANT ALL ON lead_insights TO service_role;

-- Authenticated users access via RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_insights TO authenticated;

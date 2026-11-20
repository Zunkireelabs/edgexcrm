-- Migration 292: Home Part B (EDGEX-87), the AI layer on Home: home_reads (Orca's read, B2), ai_drafts (note fills the record
-- B1, drafts B3, call prep B4, batch B5, the "is Home helping" numbers B6), and the five home_* values on
-- ai_usage_events.surface so Home's spend is metered (budget.ts sums them with 'assistant': one cap).
--
-- Additive only. Idempotent (safe to run twice).
--   Expected before/after row counts: home_reads 0 -> 0, ai_drafts 0 -> 0, ai_usage_events unchanged (only the CHECK is widened).
--   Rollback:
--     DROP TABLE IF EXISTS ai_drafts; DROP TABLE IF EXISTS home_reads;
--     ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_surface_check;
--     ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_surface_check
--       CHECK (surface IN ('assistant', 'ingestion', 'background_agent', 'retrieval'));
--     (the re-add fails if home_* rows exist: delete them first)
--   Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_surface_check;
ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_surface_check
  CHECK (surface IN (
    'assistant', 'ingestion', 'background_agent', 'retrieval',
    'home_read', 'home_draft', 'home_prep', 'home_note', 'home_batch'
  ));

-- Orca's read on Home: one row per user, per scope, per day. Stored, not remade on every load.
CREATE TABLE IF NOT EXISTS home_reads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('me', 'business')),
  for_date     DATE NOT NULL,
  points       JSONB NOT NULL DEFAULT '[]'::jsonb,
  made_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  model        TEXT,
  refreshes    INT NOT NULL DEFAULT 0,
  feedback     SMALLINT CHECK (feedback IN (-1, 1)),
  feedback_at  TIMESTAMPTZ,
  UNIQUE (tenant_id, user_id, scope, for_date)
);
CREATE INDEX IF NOT EXISTS idx_home_reads_tenant_user ON home_reads (tenant_id, user_id, made_at DESC);

-- Everything Orca drafts, proposes or prepares on Home, and what the person did with it.
CREATE TABLE IF NOT EXISTS ai_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  lead_id       UUID REFERENCES leads(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL CHECK (surface IN ('home_note', 'home_draft', 'home_prep', 'home_batch')),
  channel       TEXT,
  draft_text    TEXT,
  final_text    TEXT,
  outcome       TEXT CHECK (outcome IN ('sent_as_is', 'edited', 'discarded', 'opened', 'fields_saved')),
  records_read  JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed      JSONB,
  kept          JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_tenant_user ON ai_drafts (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_lead ON ai_drafts (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE home_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home_reads_select" ON home_reads;
CREATE POLICY "home_reads_select" ON home_reads
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "home_reads_insert_own" ON home_reads;
CREATE POLICY "home_reads_insert_own" ON home_reads
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid());
DROP POLICY IF EXISTS "home_reads_update_own" ON home_reads;
CREATE POLICY "home_reads_update_own" ON home_reads
  FOR UPDATE USING (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid());

DROP POLICY IF EXISTS "ai_drafts_select" ON ai_drafts;
CREATE POLICY "ai_drafts_select" ON ai_drafts
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
DROP POLICY IF EXISTS "ai_drafts_insert_own" ON ai_drafts;
CREATE POLICY "ai_drafts_insert_own" ON ai_drafts
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid());
DROP POLICY IF EXISTS "ai_drafts_update_own" ON ai_drafts;
CREATE POLICY "ai_drafts_update_own" ON ai_drafts
  FOR UPDATE USING (tenant_id IN (SELECT get_user_tenant_ids()) AND user_id = auth.uid());

INSERT INTO public.schema_migrations (version) VALUES ('292_home_ai.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

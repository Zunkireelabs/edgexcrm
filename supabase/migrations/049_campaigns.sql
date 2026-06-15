-- Migration 049: Campaigns (prediction leaderboard feature for education_consultancy)
-- Additive + idempotent. Apply to LOCAL DB only — Opus reviews before shared DB.

-- ============================================================
-- 1. campaigns table
-- ============================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'prediction_leaderboard',
  form_config_id  UUID REFERENCES form_configs(id) ON DELETE SET NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'final')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status ON campaigns(tenant_id, status);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'campaigns_select') THEN
    CREATE POLICY "campaigns_select" ON campaigns
      FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'campaigns_insert') THEN
    CREATE POLICY "campaigns_insert" ON campaigns
      FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'campaigns_update') THEN
    CREATE POLICY "campaigns_update" ON campaigns
      FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'campaigns_delete') THEN
    CREATE POLICY "campaigns_delete" ON campaigns
      FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_campaigns_updated_at'
  ) THEN
    CREATE TRIGGER trigger_campaigns_updated_at
      BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- 2. campaign_results table
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  match_id      TEXT NOT NULL,
  match_label   TEXT NOT NULL DEFAULT '',
  home_team     TEXT,
  away_team     TEXT,
  home_score    INT,
  away_score    INT,
  outcome       TEXT CHECK (outcome IN ('team_a', 'team_b', 'draw')),
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'final')),
  source        TEXT NOT NULL DEFAULT 'espn' CHECK (source IN ('espn', 'manual')),
  locked        BOOLEAN NOT NULL DEFAULT false,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_results_campaign ON campaign_results(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_results_tenant ON campaign_results(tenant_id);

ALTER TABLE campaign_results ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_results' AND policyname = 'campaign_results_select') THEN
    CREATE POLICY "campaign_results_select" ON campaign_results
      FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_results' AND policyname = 'campaign_results_insert') THEN
    CREATE POLICY "campaign_results_insert" ON campaign_results
      FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_results' AND policyname = 'campaign_results_update') THEN
    CREATE POLICY "campaign_results_update" ON campaign_results
      FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_results' AND policyname = 'campaign_results_delete') THEN
    CREATE POLICY "campaign_results_delete" ON campaign_results
      FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

-- ============================================================
-- 3. Idempotent seed: World Cup campaign for Admizz
-- ============================================================
INSERT INTO campaigns (tenant_id, name, slug, type, form_config_id, config, status)
SELECT
  t.id,
  'FIFA World Cup 2026 — Predict & Win',
  'worldcup-2026',
  'prediction_leaderboard',
  f.id,
  '{
    "provider": "espn",
    "league": "fifa.world",
    "fields": {
      "match_id": "match_id",
      "match_label": "match_label",
      "prediction": "prediction"
    },
    "outcomes": {
      "team_a": "team_a",
      "team_b": "team_b",
      "draw": "draw"
    },
    "ranking_rule": "most_correct",
    "exclude_domains": ["zunkireelabs.com"],
    "exclude_emails": [
      "test@gmail.com",
      "test@gmai.com",
      "dsasad@gmail.com",
      "anish@gmail.com",
      "canada@gmail.com"
    ]
  }'::jsonb,
  'active'
FROM tenants t
JOIN form_configs f ON f.tenant_id = t.id
WHERE t.slug = 'admizz'
  AND f.slug = 'worldcup-predict-win'
ON CONFLICT DO NOTHING;

-- Phase A1 — Lead Dedup: schema foundation
-- ==========================================
-- Adds: lead_submissions (append-only), leads.normalized_email generated column +
-- partial unique index (see deferred-index comment below), leads.merged_into,
-- lead_merges, lead_duplicate_suggestions.
-- This migration is PURELY ADDITIVE — no existing behavior changes.

-- ============================================================
-- 1. lead_submissions — append-only raw-payload log
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  form_config_id    UUID REFERENCES form_configs(id) ON DELETE SET NULL,
  session_id        VARCHAR(100),
  created_via       TEXT NOT NULL
                    CHECK (created_via IN ('public_form','public_api','integration','manual','backfill')),
  idempotency_key   VARCHAR(100),
  first_name        TEXT,
  last_name         TEXT,
  email             TEXT,
  phone             TEXT,
  city              TEXT,
  country           TEXT,
  normalized_email  TEXT,           -- trim+lowercase snapshot used for matching
  normalized_phone  TEXT,           -- digits+'+' snapshot (suggestions only)
  custom_fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
  file_urls         JSONB NOT NULL DEFAULT '{}'::jsonb,
  intake_source     TEXT,
  intake_medium     TEXT,
  intake_campaign   TEXT,
  entity_id         UUID,           -- loose, NO FK (entity may be deleted)
  raw_payload       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- verbatim inbound body = true no-loss
  matched_existing  BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_submissions_lead
  ON lead_submissions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_submissions_tenant_email
  ON lead_submissions (tenant_id, normalized_email) WHERE normalized_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_submissions_tenant_created
  ON lead_submissions (tenant_id, created_at DESC);

ALTER TABLE lead_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view lead submissions" ON lead_submissions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
-- No INSERT/UPDATE/DELETE policy — service role only writes (mirrors audit_logs).

-- ============================================================
-- 2. leads.normalized_email generated column + race-backstop unique index
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS normalized_email TEXT
  GENERATED ALWAYS AS (lower(btrim(email))) STORED;

-- Auto-dedup correctness backstop: two concurrent NEW-email inserts → 2nd gets 23505.
-- Scoped to live, final leads only, so multi-step drafts (is_final=false) never collide.
--
-- ⚠️  DEFERRED-INDEX NOTE: this partial unique index will FAIL to create if the shared
-- Supabase DB already contains duplicate (tenant_id, normalized_email) live+final rows
-- (the 4 sadins).  On a LOCAL / fresh DB it creates fine (no existing dupes).
-- The shared-DB application of this index is DEFERRED until Phase B backfill has
-- collapsed existing duplicates.  Opus decides the shared-DB sequencing — do NOT
-- attempt to apply this index to the shared project until told to do so.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_norm_email
  ON leads (tenant_id, normalized_email)
  WHERE normalized_email IS NOT NULL AND deleted_at IS NULL AND is_final = true;

-- ============================================================
-- 3. Merge-support tables (used in Phase B; schema created here for completeness)
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS lead_merges (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  canonical_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  absorbed_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  merged_by        UUID,                -- auth.users id, NULL for backfill
  source           TEXT NOT NULL CHECK (source IN ('manual','backfill')),
  repointed_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_patch      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- exact patch applied → reversibility
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lead_merges_tenant ON lead_merges (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_merges_absorbed ON lead_merges (absorbed_id);

ALTER TABLE lead_merges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view lead merges" ON lead_merges
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE TABLE IF NOT EXISTS lead_duplicate_suggestions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  suggested_lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  reason            TEXT NOT NULL CHECK (reason IN ('phone','name')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','merged')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, lead_id, suggested_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_dup_suggestions_open
  ON lead_duplicate_suggestions (tenant_id, status) WHERE status = 'open';

ALTER TABLE lead_duplicate_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can view dup suggestions" ON lead_duplicate_suggestions
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Tenant admins can update dup suggestions" ON lead_duplicate_suggestions
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

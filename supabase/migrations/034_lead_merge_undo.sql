-- Phase B — Lead Dedup: undo support + deferred unique index
-- =============================================================
-- 1. lead_merges.undone_at — clean audit trail for undo operations.
-- 2. lead_merges.synthesized_submission_id — tracks the submission row
--    created during merge so undo can delete it precisely.
-- 3. uq_leads_tenant_norm_email — race-backstop unique index.
--    ⚠️  DDL ONLY.  Do NOT run on the shared Supabase DB until Phase B backfill
--    has confirmed zero live duplicate groups (see LEAD-DEDUP-PHASE-B-BRIEF.md).
--    On a local / fresh DB, apply the whole file.  On shared DB, apply only
--    statements 1–2 now; apply statement 3 after backfill verification.

-- 1. Undo timestamp
ALTER TABLE lead_merges
  ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;

-- 2. Reference to synthesized submission row so undo can delete it precisely
ALTER TABLE lead_merges
  ADD COLUMN IF NOT EXISTS synthesized_submission_id UUID REFERENCES lead_submissions(id) ON DELETE SET NULL;

-- 3. Row IDs moved during merge, keyed by table name — used for precise undo
--    without accidentally moving the canonical lead's own children back.
--    Shape: { "lead_notes": ["uuid",...], "lead_activities": [...], ... }
ALTER TABLE lead_merges
  ADD COLUMN IF NOT EXISTS repointed_ids JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. DEFERRED unique index — collapse duplicates first, then create this.
--    Partial: live + final rows only; absorbed leads (deleted_at IS NOT NULL) are excluded.
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_norm_email
--   ON leads (tenant_id, normalized_email)
--   WHERE normalized_email IS NOT NULL AND deleted_at IS NULL AND is_final = true;

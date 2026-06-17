-- Migration 054: Add match_date to campaign_results
-- Additive, no data change, no RLS change. Idempotent (IF NOT EXISTS).
-- Write only — Sadin applies (shared prod DB).

ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS match_date TIMESTAMPTZ;

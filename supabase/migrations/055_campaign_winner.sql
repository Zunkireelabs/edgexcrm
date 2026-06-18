-- Migration 055: Add winner_email to campaign_results (per-match winner override)
-- Additive, idempotent. NULL = use system auto-pick; non-null = admin manual override.
-- Write only — Sadin applies (shared prod DB).

ALTER TABLE campaign_results ADD COLUMN IF NOT EXISTS winner_email TEXT;

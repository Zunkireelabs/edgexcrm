-- Migration 050: Campaigns public leaderboard (additive)
-- 049 is already applied to the shared DB. This file extends campaigns only.
-- DO NOT apply to shared DB — Opus reviews before applying.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS public_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_public_token
  ON campaigns(public_token) WHERE public_token IS NOT NULL;

-- 104_proposals_public_share.sql — Proposals Phase 2 (public share link)
BEGIN;

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS public_token   TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS public_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- token is unguessable + unique; only enforced when set
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_public_token
  ON proposals(public_token) WHERE public_token IS NOT NULL;

COMMIT;

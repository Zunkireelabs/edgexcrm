-- Migration 105: Deals v2-A — stage default probability + per-deal override.
-- Additive, idempotent, transaction-wrapped. it_agency Deals feature.
BEGIN;

-- Per-stage default probability (0-100). Every stage has one.
ALTER TABLE deal_stages
  ADD COLUMN IF NOT EXISTS probability SMALLINT NOT NULL DEFAULT 50
  CHECK (probability >= 0 AND probability <= 100);

-- Per-deal override (NULL = inherit the stage's probability).
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS probability SMALLINT
  CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));

-- Backfill sensible defaults on existing stages.
UPDATE deal_stages SET probability = 100 WHERE is_terminal AND terminal_type = 'won';
UPDATE deal_stages SET probability = 0   WHERE is_terminal AND terminal_type = 'lost';
UPDATE deal_stages SET probability = 10  WHERE slug = 'qualification'  AND is_terminal = false;
UPDATE deal_stages SET probability = 30  WHERE slug = 'needs-analysis' AND is_terminal = false;
UPDATE deal_stages SET probability = 50  WHERE slug = 'proposal'       AND is_terminal = false;
UPDATE deal_stages SET probability = 70  WHERE slug = 'negotiation'    AND is_terminal = false;
-- Any other existing custom stage keeps the DEFAULT 50.

COMMIT;

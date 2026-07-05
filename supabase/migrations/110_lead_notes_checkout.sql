-- Add checkout timestamp to check-in notes so staff can mark when a visitor leaves.
-- Rollback: ALTER TABLE lead_notes DROP COLUMN IF EXISTS checked_out_at;

ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ NULL;

-- Migration 028: Add read_at column to emails table for tracking inbound read state

ALTER TABLE emails ADD COLUMN read_at TIMESTAMPTZ;

-- Backfill: mark existing inbound emails as read so users aren't flooded on deploy
UPDATE emails SET read_at = COALESCE(received_at, sent_at, created_at)
WHERE direction = 'inbound' AND read_at IS NULL;

-- Partial index for fast unread inbound lookups
CREATE INDEX idx_emails_unread_inbound ON emails (thread_id)
WHERE direction = 'inbound' AND read_at IS NULL;

-- 035_last_activity_at.sql
-- Adds leads.last_activity_at for form-submission-driven recency tracking.
-- last_activity_at is bumped by every form submission (never by edits/logged calls).
-- Applied to local/throwaway DB only by Sonnet; Opus applies to shared after review.

ALTER TABLE leads ADD COLUMN last_activity_at TIMESTAMPTZ;

-- Backfill: use MAX submission date for any lead that has submissions; otherwise use created_at.
UPDATE leads
SET last_activity_at = COALESCE(
  (SELECT MAX(s.created_at) FROM lead_submissions s WHERE s.lead_id = leads.id),
  leads.created_at
);

ALTER TABLE leads ALTER COLUMN last_activity_at SET DEFAULT now();
ALTER TABLE leads ALTER COLUMN last_activity_at SET NOT NULL;

-- Partial index matching getLeads filters for efficient last-activity-desc sorting.
CREATE INDEX idx_leads_last_activity_at
ON leads (tenant_id, last_activity_at DESC)
WHERE deleted_at IS NULL AND converted_at IS NULL;

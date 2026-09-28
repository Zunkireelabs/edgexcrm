-- Migration 250: leads.last_touched_at (follow-up-needed) + leads.callback_due_at
-- (callback-due), one shared trigger function on lead_activities/lead_notes INSERT,
-- plus a one-time backfill for both columns.
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: leads: N -> N (0 rows added/removed; two
--     columns backfilled on existing rows only).
--   Rollback: DROP TRIGGER trg_lead_activities_touch_signals ON lead_activities;
--     DROP TRIGGER trg_lead_notes_touch_signals ON lead_notes;
--     DROP FUNCTION update_lead_touch_signals();
--     ALTER TABLE leads DROP COLUMN last_touched_at, DROP COLUMN callback_due_at;
--   Applied: stage HELD / prod HELD.

BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_touched_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS callback_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_last_touched_at ON leads(last_touched_at);
CREATE INDEX IF NOT EXISTS idx_leads_callback_due_at ON leads(callback_due_at) WHERE callback_due_at IS NOT NULL;

-- One shared trigger function for both signals, fired off both lead_activities
-- and lead_notes INSERT (see CROSS-FEATURE brief — same event, same file,
-- don't split into two trigger functions).
--
--   last_touched_at: any qualifying touch (call/email/meeting activity, or a
--   note) moves it forward. The `< NEW.created_at` guard stops an out-of-order
--   or backfilled insert from moving it backwards.
--
--   callback_due_at: only lead_activities rows drive this (lead_notes never
--   touches it).
--     - a call with outcome no_answer/busy sets/resets it to
--       NEW.created_at + callback_reminder_minutes (repeat missed calls RESET
--       the window to the new call's time, never additive).
--     - any other qualifying touch after a pending callback (a connected call,
--       any email/meeting activity, or — via the lead_notes branch below — a
--       note) clears it.
--   callback_reminder_minutes is read from tenants.config.team_performance_thresholds
--   (default 10) — same config object as follow_up_stale_days, resolved here via a
--   COALESCE chain since there is no SQL-side resolveThresholds() to call.
CREATE OR REPLACE FUNCTION update_lead_touch_signals()
RETURNS TRIGGER AS $$
DECLARE
  v_reminder_minutes INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'lead_activities' THEN
    IF NEW.activity_type NOT IN ('call', 'email', 'meeting') THEN
      RETURN NEW;
    END IF;

    UPDATE leads
    SET last_touched_at = NEW.created_at
    WHERE id = NEW.lead_id
      AND (last_touched_at IS NULL OR last_touched_at < NEW.created_at);

    IF NEW.activity_type = 'call' AND NEW.call_outcome IN ('no_answer', 'busy') THEN
      SELECT COALESCE(
        (t.config -> 'team_performance_thresholds' ->> 'callback_reminder_minutes')::INTEGER,
        10
      ) INTO v_reminder_minutes
      FROM tenants t
      WHERE t.id = NEW.tenant_id;

      UPDATE leads
      SET callback_due_at = NEW.created_at + (v_reminder_minutes || ' minutes')::INTERVAL
      WHERE id = NEW.lead_id;
    ELSE
      UPDATE leads
      SET callback_due_at = NULL
      WHERE id = NEW.lead_id AND callback_due_at IS NOT NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'lead_notes' THEN
    UPDATE leads
    SET last_touched_at = NEW.created_at
    WHERE id = NEW.lead_id
      AND (last_touched_at IS NULL OR last_touched_at < NEW.created_at);

    UPDATE leads
    SET callback_due_at = NULL
    WHERE id = NEW.lead_id AND callback_due_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_activities_touch_signals ON lead_activities;
CREATE TRIGGER trg_lead_activities_touch_signals
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION update_lead_touch_signals();

DROP TRIGGER IF EXISTS trg_lead_notes_touch_signals ON lead_notes;
CREATE TRIGGER trg_lead_notes_touch_signals
  AFTER INSERT ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION update_lead_touch_signals();

-- ── Backfill (set-based, idempotent — re-running recomputes the same result) ──

-- last_touched_at: most recent qualifying touch (call/email/meeting activity,
-- or a note) per lead, from current lead_activities/lead_notes rows.
WITH latest_touch AS (
  SELECT lead_id, MAX(created_at) AS touched_at FROM (
    SELECT lead_id, created_at FROM lead_activities WHERE activity_type IN ('call', 'email', 'meeting')
    UNION ALL
    SELECT lead_id, created_at FROM lead_notes
  ) touches
  GROUP BY lead_id
)
UPDATE leads
SET last_touched_at = latest_touch.touched_at
FROM latest_touch
WHERE leads.id = latest_touch.lead_id
  AND (leads.last_touched_at IS NULL OR leads.last_touched_at <> latest_touch.touched_at);

-- callback_due_at: for any lead whose most recent qualifying activity (by
-- created_at, across call/email/meeting) is itself a no_answer/busy call,
-- set callback_due_at = that call's created_at + the tenant's
-- callback_reminder_minutes (consistent with the live trigger logic above).
WITH latest_activity AS (
  SELECT DISTINCT ON (lead_id) lead_id, tenant_id, created_at, activity_type, call_outcome
  FROM lead_activities
  WHERE activity_type IN ('call', 'email', 'meeting')
  ORDER BY lead_id, created_at DESC
),
pending_callback AS (
  SELECT
    la.lead_id,
    la.created_at + (
      COALESCE((t.config -> 'team_performance_thresholds' ->> 'callback_reminder_minutes')::INTEGER, 10) || ' minutes'
    )::INTERVAL AS due_at
  FROM latest_activity la
  JOIN tenants t ON t.id = la.tenant_id
  WHERE la.activity_type = 'call' AND la.call_outcome IN ('no_answer', 'busy')
)
UPDATE leads
SET callback_due_at = pending_callback.due_at
FROM pending_callback
WHERE leads.id = pending_callback.lead_id
  AND (leads.callback_due_at IS NULL OR leads.callback_due_at <> pending_callback.due_at);

INSERT INTO public.schema_migrations (version) VALUES ('250_leads_touch_and_callback_signals.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

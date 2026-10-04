-- Migration 261: runner heartbeats — so a silently stopped background timer becomes visible (Outreach Phase 4).
--
-- Why: the email-blast, scheduled-send, bulk-enroll and auto-send workers are in-process timers
-- (src/instrumentation.ts), not Inngest. If one wedges or stops, nothing fails loudly — scheduled emails just never go
-- out. Each timer now records a heartbeat row after every pass (success or error) and
-- GET /api/health/runners turns "no finished pass for N minutes" into an HTTP 503 an external monitor can alert on
-- (docs/reference/04-PROD-RESILIENCE.md).
--
-- One row per runner name. Global ops data, NOT tenant-owned (it says nothing about any tenant's data), so there is no
-- tenant_id; RLS is enabled with NO policies, which leaves it readable/writable only through the service role.
--
-- Additive only: one NEW empty table.
--   Expected before/after row counts: 0 rows touched (new table; the first rows appear when the timers first run).
--   Rollback: DROP TABLE IF EXISTS public.runner_heartbeats;
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE TABLE IF NOT EXISTS public.runner_heartbeats (
  name TEXT PRIMARY KEY,
  last_started_at TIMESTAMPTZ,
  last_finished_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.runner_heartbeats ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version) VALUES ('261_runner_heartbeats.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

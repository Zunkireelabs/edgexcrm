-- Migration 135: task start/stop timers (active_timers) + time_entries.source provenance.
-- Additive only. Rollback: DROP TABLE active_timers; ALTER TABLE time_entries DROP COLUMN source;
-- Row counts: active_timers = new (0 rows); time_entries column-add only (existing rows -> 'manual' by DEFAULT).
-- Applied: local only (stage/prod HELD).

BEGIN;

-- 1. Provenance: 'manual' (form) vs 'timer' (stop of a running timer).
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','timer'));

-- 2. active_timers: at most ONE running timer per (user, task); different tasks may run at once.
CREATE TABLE IF NOT EXISTS active_timers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id)      ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT active_timers_user_task_uniq UNIQUE (user_id, task_id)
);

ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_timers_select" ON active_timers;
CREATE POLICY "active_timers_select" ON active_timers
  FOR SELECT USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (user_id = auth.uid() OR is_tenant_admin(tenant_id))
  );

DROP POLICY IF EXISTS "active_timers_insert" ON active_timers;
CREATE POLICY "active_timers_insert" ON active_timers
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "active_timers_delete" ON active_timers;
CREATE POLICY "active_timers_delete" ON active_timers
  FOR DELETE USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (user_id = auth.uid() OR is_tenant_admin(tenant_id))
  );
-- No UPDATE policy: timers are write-once; "stop" = DELETE the timer + INSERT a time_entry.

CREATE INDEX IF NOT EXISTS idx_active_timers_tenant_user
  ON active_timers (tenant_id, user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_active_timers_task ON active_timers (task_id);

INSERT INTO public.schema_migrations (version) VALUES ('135_task_timers.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

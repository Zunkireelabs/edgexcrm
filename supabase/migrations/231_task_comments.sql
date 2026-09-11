-- Migration 231: Task comments (it_agency Round 2 slice C, Phase 2)
--
-- Additive only. Wrap in BEGIN/COMMIT.
--   Expected before/after row counts: task_comments 0 -> 0 (new empty table).
--   Rollback: DROP TABLE IF EXISTS task_comments;
--   Applied: stage HELD / prod HELD.
--
-- Context: docs/IT-AGENCY-ROUND2-TASK-PANEL-BRIEF.md §3.1. Same table/RLS/
-- ledger idiom as email_blasts (migration 214).
--
-- author_id is nullable with ON DELETE SET NULL (same idiom as
-- email_blasts.created_by) — removing a teammate must not erase the
-- conversation. The UI renders such a comment as "Former member".
--
-- Note for the reviewer: migration 195 revoked SELECT on public tables from
-- `authenticated`, so these RLS policies are belt-and-braces — the app
-- reaches this table through scopedClient (service role). No GRANT is
-- needed because nothing embeds this table via a PostgREST !inner from an
-- RPC.

BEGIN;

CREATE TABLE IF NOT EXISTS task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id    UUID NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
  author_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- nullable by design
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_time ON task_comments (task_id, created_at);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can view task comments" ON task_comments;
CREATE POLICY "Tenant members can view task comments"
  ON task_comments FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

DROP POLICY IF EXISTS "Tenant admins can mutate task comments" ON task_comments;
CREATE POLICY "Tenant admins can mutate task comments"
  ON task_comments FOR ALL
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Service role full access to task comments" ON task_comments;
CREATE POLICY "Service role full access to task comments"
  ON task_comments FOR ALL
  USING (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS set_task_comments_updated_at ON task_comments;
CREATE TRIGGER set_task_comments_updated_at
  BEFORE UPDATE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('231_task_comments.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

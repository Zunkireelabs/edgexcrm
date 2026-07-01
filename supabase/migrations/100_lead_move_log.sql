-- 100_lead_move_log.sql
-- Records every list/assignment change on a lead so privileged roles can undo
-- a mistaken move or edit it, while precisely revoking the view access that
-- reassignment grants via lead_collaborators (see migration 090).
--
-- prev_* is a full snapshot of the pre-change state so undo restores the exact
-- prior stage/status/list — not just the destination list's default stage.
-- collaborator_added_user_id records the ONE user this specific change newly
-- added to lead_collaborators (null if they were already a collaborator), so
-- undo can revoke exactly that grant without touching earlier legitimate ones.

CREATE TABLE IF NOT EXISTS lead_move_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  changed_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- prior state snapshot
  prev_list_id                UUID REFERENCES lead_lists(id) ON DELETE SET NULL,
  prev_pipeline_id            UUID REFERENCES pipelines(id) ON DELETE SET NULL,
  prev_stage_id               UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  prev_status                 TEXT,
  prev_lead_type              TEXT,
  prev_archive_reason         TEXT,
  prev_assigned_to            UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- new state
  new_list_id                 UUID REFERENCES lead_lists(id) ON DELETE SET NULL,
  new_assigned_to             UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- collaborator grant this change caused (null if the assignee was already a collaborator)
  collaborator_added_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  reverted_at                 TIMESTAMPTZ,
  reverted_by                 UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Primary query: "latest non-reverted move for this lead"
CREATE INDEX IF NOT EXISTS idx_lead_move_log_lead_active
  ON lead_move_log (lead_id, created_at DESC)
  WHERE reverted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_move_log_tenant
  ON lead_move_log (tenant_id, created_at DESC);

ALTER TABLE lead_move_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_move_log_select" ON lead_move_log
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lead_move_log_insert" ON lead_move_log
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "lead_move_log_update" ON lead_move_log
  FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

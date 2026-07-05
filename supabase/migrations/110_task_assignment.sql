-- 110_task_assignment.sql — universal task assignment. Global (all industries).
-- Assign a task to any tenant member; it surfaces on their Home → My Tasks.
-- Additive, idempotent, transaction-wrapped. FLAT permission model (governance is a later phase).
BEGIN;

-- Who assigned it (NULL = self-created). Attribution for "assigned by X" + notification.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Link a task to a deal (the "from a deal" entry point). lead_id + project_id already exist.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks (deal_id) WHERE deal_id IS NOT NULL;

-- FLAT assignment: any tenant member may create a task assigned to any member.
-- tasks_select (migration 020) is already tenant-scoped and untouched — no widening needed.
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));

-- Manage tasks you OWN (assignee), CREATED (assigned_by), or as admin.
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (tenant_id IN (SELECT get_user_tenant_ids())
         AND (assignee_id = auth.uid() OR assigned_by_id = auth.uid() OR is_tenant_admin(tenant_id)));
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (tenant_id IN (SELECT get_user_tenant_ids())
         AND (assignee_id = auth.uid() OR assigned_by_id = auth.uid() OR is_tenant_admin(tenant_id)));

COMMIT;

-- 032_personal_tasks.sql
-- Make tasks standalone so they exist independent of a project (personal to-dos),
-- and let a member manage THEIR OWN tasks (was admin-only).

ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_due
  ON tasks (tenant_id, assignee_id, due_date) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_lead
  ON tasks (lead_id) WHERE lead_id IS NOT NULL;

-- Relax RLS: own-task OR tenant-admin. (The API path uses the service-role
-- scopedClient and enforces ownership in code; this keeps RLS correct as
-- belt-and-suspenders for any RLS-respecting access.)
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids())
             AND (is_tenant_admin(tenant_id) OR assignee_id = auth.uid()));
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (is_tenant_admin(tenant_id) OR assignee_id = auth.uid());
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (is_tenant_admin(tenant_id) OR assignee_id = auth.uid());

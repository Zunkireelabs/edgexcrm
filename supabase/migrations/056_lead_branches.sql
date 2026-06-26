-- Migration 056: lead_branches (multi-branch lead sharing membership)
-- Additive + idempotent. Inert for single-branch tenants. Write only — Sadin applies (shared prod DB).

CREATE TABLE IF NOT EXISTS lead_branches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES leads(id)    ON DELETE CASCADE,
  branch_id    UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  assigned_to  UUID REFERENCES auth.users(id)        ON DELETE SET NULL,  -- per-branch counselor
  is_origin    BOOLEAN NOT NULL DEFAULT false,
  shared_by    UUID REFERENCES auth.users(id)        ON DELETE SET NULL,
  shared_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_branches_branch   ON lead_branches(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_lead_branches_lead     ON lead_branches(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_branches_assignee ON lead_branches(assigned_to) WHERE assigned_to IS NOT NULL;
-- exactly one origin per lead
CREATE UNIQUE INDEX IF NOT EXISTS uniq_lead_branches_origin ON lead_branches(lead_id) WHERE is_origin;

ALTER TABLE lead_branches ENABLE ROW LEVEL SECURITY;

-- RLS mirrors branches (mig 052): select = tenant members; writes = tenant admins (defense-in-depth)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_select') THEN
    CREATE POLICY "lead_branches_select" ON lead_branches FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_insert') THEN
    CREATE POLICY "lead_branches_insert" ON lead_branches FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_update') THEN
    CREATE POLICY "lead_branches_update" ON lead_branches FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_branches' AND policyname='lead_branches_delete') THEN
    CREATE POLICY "lead_branches_delete" ON lead_branches FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

-- Backfill: one origin row per already-branched lead. Idempotent via UNIQUE(lead_id,branch_id).
-- Leads with branch_id IS NULL get NO row (matches today's behavior). Skip soft-deleted leads.
INSERT INTO lead_branches (tenant_id, lead_id, branch_id, assigned_to, is_origin, shared_by)
SELECT l.tenant_id, l.id, l.branch_id, l.assigned_to, true, NULL
FROM leads l
WHERE l.branch_id IS NOT NULL
  AND l.deleted_at IS NULL
ON CONFLICT (lead_id, branch_id) DO NOTHING;

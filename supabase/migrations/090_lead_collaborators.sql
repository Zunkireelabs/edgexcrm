-- Migration 090: Lead Collaborators
-- Remembers every user who has been assigned to a lead, so they retain VIEW
-- access to that lead even after it is reassigned / moves stage or list.
-- Additive + idempotent. No behavior change until rows exist (own-scope query
-- only widens to include a user's collaborator leads).

BEGIN;

-- ─── 1. Table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_collaborators (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  lead_id     UUID NOT NULL REFERENCES leads(id)      ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_collaborators_user ON lead_collaborators(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_lead_collaborators_lead ON lead_collaborators(lead_id);

ALTER TABLE lead_collaborators ENABLE ROW LEVEL SECURITY;

-- RLS mirrors lead_branches (mig 056): select = tenant members; writes = tenant admins.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_collaborators' AND policyname='lead_collaborators_select') THEN
    CREATE POLICY "lead_collaborators_select" ON lead_collaborators FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_collaborators' AND policyname='lead_collaborators_insert') THEN
    CREATE POLICY "lead_collaborators_insert" ON lead_collaborators FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lead_collaborators' AND policyname='lead_collaborators_delete') THEN
    CREATE POLICY "lead_collaborators_delete" ON lead_collaborators FOR DELETE USING (is_tenant_admin(tenant_id));
  END IF;
END $$;

-- ─── 2. Backfill: current assignees ────────────────────────────────────────
INSERT INTO lead_collaborators (tenant_id, lead_id, user_id)
SELECT tenant_id, id, assigned_to
FROM   leads
WHERE  assigned_to IS NOT NULL
  AND  deleted_at IS NULL
ON CONFLICT (lead_id, user_id) DO NOTHING;

-- ─── 3. Backfill: historical assignees from the assignment audit trail ──────
-- audit_logs rows (action lead.updated) carry changes->'assigned_to'->>'old'/'new'.
-- Migration 082 already seeded this trail for existing data.
INSERT INTO lead_collaborators (tenant_id, lead_id, user_id)
SELECT a.tenant_id, a.entity_id, u.uid
FROM   audit_logs a
CROSS JOIN LATERAL (
  VALUES (a.changes->'assigned_to'->>'old'), (a.changes->'assigned_to'->>'new')
) AS v(uid_text)
CROSS JOIN LATERAL (SELECT NULLIF(v.uid_text, '')::uuid AS uid) u
WHERE  a.entity_type = 'lead'
  AND  a.changes ? 'assigned_to'
  AND  u.uid IS NOT NULL
  AND  EXISTS (SELECT 1 FROM leads l WHERE l.id = a.entity_id AND l.deleted_at IS NULL)
ON CONFLICT (lead_id, user_id) DO NOTHING;

-- ─── 4. Logging ────────────────────────────────────────────────────────────
DO $$
DECLARE v_rows INT;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM lead_collaborators;
  RAISE NOTICE '090 lead_collaborators: % rows after backfill', v_rows;
END$$;

COMMIT;

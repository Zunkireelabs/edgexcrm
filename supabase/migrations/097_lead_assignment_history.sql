-- 089_lead_assignment_history.sql
-- Records every user-to-user reassignment of a lead, with snapshots of both
-- users' position_id at the moment of the handoff. Powers the Follow-ups page:
-- "leads I once held and passed on to a peer in the same position."
--
-- Why snapshot positions? If a user is later promoted, the history row stays
-- intact so they still see leads they handed off as a counsellor.

CREATE TABLE IF NOT EXISTS lead_assignment_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_position_id  UUID REFERENCES positions(id) ON DELETE SET NULL,
  to_position_id    UUID REFERENCES positions(id) ON DELETE SET NULL,
  changed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query: "leads where I am the from_user AND it was a same-position handoff"
CREATE INDEX IF NOT EXISTS idx_lah_tenant_from_user
  ON lead_assignment_history (tenant_id, from_user_id);
CREATE INDEX IF NOT EXISTS idx_lah_lead
  ON lead_assignment_history (lead_id);

ALTER TABLE lead_assignment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lah_select" ON lead_assignment_history
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "lah_insert" ON lead_assignment_history
  FOR INSERT WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()));
-- No update/delete policies: history is immutable.

-- ── Best-effort backfill from audit_logs ──
-- For every prior assignment change (audit_logs row with changes.assigned_to),
-- insert a history row using each user's CURRENT position_id. Imperfect for
-- users who changed positions after the handoff, but covers the common case.
INSERT INTO lead_assignment_history (
  tenant_id, lead_id, from_user_id, to_user_id,
  from_position_id, to_position_id, changed_by, created_at
)
SELECT
  a.tenant_id,
  a.entity_id                                                 AS lead_id,
  ((a.changes->'assigned_to'->>'old')::uuid)                  AS from_user_id,
  ((a.changes->'assigned_to'->>'new')::uuid)                  AS to_user_id,
  tu_from.position_id                                         AS from_position_id,
  tu_to.position_id                                           AS to_position_id,
  a.user_id                                                   AS changed_by,
  a.created_at
FROM audit_logs a
JOIN leads l         ON l.id = a.entity_id AND l.tenant_id = a.tenant_id
LEFT JOIN tenant_users tu_from
  ON tu_from.tenant_id = a.tenant_id
 AND tu_from.user_id   = (a.changes->'assigned_to'->>'old')::uuid
LEFT JOIN tenant_users tu_to
  ON tu_to.tenant_id   = a.tenant_id
 AND tu_to.user_id     = (a.changes->'assigned_to'->>'new')::uuid
WHERE a.entity_type = 'lead'
  AND a.changes ? 'assigned_to'
  AND (a.changes->'assigned_to'->>'old') IS NOT NULL
  AND (a.changes->'assigned_to'->>'new') IS NOT NULL
  AND (a.changes->'assigned_to'->>'old') <> (a.changes->'assigned_to'->>'new')
ON CONFLICT DO NOTHING;

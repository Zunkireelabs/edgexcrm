-- 109_proposal_views.sql — Proposals Phase 3a (public view tracking)
BEGIN;

CREATE TABLE IF NOT EXISTS proposal_views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  proposal_id   UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  viewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposal_views_proposal ON proposal_views(tenant_id, proposal_id, viewed_at DESC);

ALTER TABLE proposal_views ENABLE ROW LEVEL SECURITY;

-- SELECT-only: the only writer is the public share page via the service-role client,
-- which bypasses RLS. No INSERT policy on purpose — authed users never write this table.
CREATE POLICY "proposal_views_select" ON proposal_views FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

COMMIT;

-- Migration 252: the database guarantees "a lead's assignee is a collaborator".
--
-- Why: migration 090 defined lead_collaborators ("every user who has been assigned to a
-- lead") but only backfilled ONCE; from then on the invariant was kept by application
-- code that calls addLeadCollaborator() in a handful of routes. Any assignment path that
-- doesn't (e.g. the integration assign/update routes, imports, manual SQL) leaves the
-- assignee out — so they vanish from the Collaborators picker/filter and their leads never
-- match it. Enforcing it in a trigger makes every path correct, including future ones.
--
-- What it does:
--   1. AFTER INSERT / AFTER UPDATE OF assigned_to ON leads: insert (lead, assignee) into
--      lead_collaborators, idempotently (ON CONFLICT DO NOTHING). SECURITY DEFINER because
--      lead_collaborators' INSERT policy is admin-only and the writer may be anyone.
--   2. Re-run 090's two backfills (current assignees + historical assignees from the
--      assignment audit trail) to repair everything the app-code path missed since 090.
--
-- Interaction with migration 210 (leads.collaborator_count): the row this trigger inserts
-- fires 210's trg_lead_collaborators_sync_count, which UPDATEs leads.collaborator_count.
-- That UPDATE does NOT re-fire this trigger: it is `UPDATE OF assigned_to`, and the counter
-- update never lists assigned_to in its SET clause. ON CONFLICT DO NOTHING inserts no row on
-- a repeat, so the counter can't double-count.
--
-- Access: a collaborator row grants VIEW access to that lead (090). The current-assignee
-- backfill only adds users who can ALREADY see the lead as its assignee. The audit-trail
-- backfill re-applies 090's own rule (past assignees keep view access) to assignments 090's
-- run never saw.
--
-- Additive only. Idempotent (safe to run twice).
--   Expected before/after row counts: lead_collaborators grows by the number of
--     (lead, assignee/past-assignee) pairs that were missing; leads is untouched (row count
--     unchanged). leads.collaborator_count updates itself via migration 210's trigger for
--     each inserted row. To see the number BEFORE applying (read-only; run on the target DB):
--       SELECT count(*) AS active_assigned_leads_missing_their_assignee
--       FROM leads l
--       WHERE l.assigned_to IS NOT NULL AND l.deleted_at IS NULL
--         AND NOT EXISTS (SELECT 1 FROM lead_collaborators c
--                         WHERE c.lead_id = l.id AND c.user_id = l.assigned_to);
--     (Past assignees recovered from audit_logs are extra to this number.)
--   Rollback: DROP TRIGGER IF EXISTS trg_leads_assignee_is_collaborator_ins ON leads;
--             DROP TRIGGER IF EXISTS trg_leads_assignee_is_collaborator_upd ON leads;
--             DROP FUNCTION IF EXISTS leads_assignee_is_collaborator();
--             (inserted lead_collaborators rows are legitimate data; leave them.)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

-- ─── 1. Trigger function ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leads_assignee_is_collaborator() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    -- leads.assigned_to and lead_collaborators.user_id both reference auth.users(id),
    -- so this cannot violate a foreign key.
    INSERT INTO public.lead_collaborators (tenant_id, lead_id, user_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.assigned_to)
    ON CONFLICT (lead_id, user_id) DO NOTHING;
  END IF;
  RETURN NULL; -- AFTER trigger: return value is ignored
END;
$$;

-- ─── 2. Triggers ───────────────────────────────────────────────────────────
-- Two triggers (not one INSERT OR UPDATE) so the UPDATE one can be column-scoped and
-- WHEN-guarded: it fires only when assigned_to really changes to a non-null value, never
-- for the many other leads UPDATEs (including migration 210's collaborator_count writes).
DROP TRIGGER IF EXISTS trg_leads_assignee_is_collaborator_ins ON public.leads;
CREATE TRIGGER trg_leads_assignee_is_collaborator_ins
  AFTER INSERT ON public.leads
  FOR EACH ROW
  WHEN (NEW.assigned_to IS NOT NULL)
  EXECUTE FUNCTION public.leads_assignee_is_collaborator();

DROP TRIGGER IF EXISTS trg_leads_assignee_is_collaborator_upd ON public.leads;
CREATE TRIGGER trg_leads_assignee_is_collaborator_upd
  AFTER UPDATE OF assigned_to ON public.leads
  FOR EACH ROW
  WHEN (NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
  EXECUTE FUNCTION public.leads_assignee_is_collaborator();

-- ─── 3. Backfill: current assignees (same rule as migration 090 §2) ─────────
INSERT INTO public.lead_collaborators (tenant_id, lead_id, user_id)
SELECT tenant_id, id, assigned_to
FROM   public.leads
WHERE  assigned_to IS NOT NULL
  AND  deleted_at IS NULL
ON CONFLICT (lead_id, user_id) DO NOTHING;

-- ─── 4. Backfill: historical assignees from the audit trail (090 §3) ────────
-- audit_logs rows (action lead.updated) carry changes->'assigned_to'->>'old'/'new'.
-- Only ids that still exist in auth.users are inserted — a since-deleted user would
-- otherwise violate lead_collaborators.user_id's foreign key and abort the migration.
INSERT INTO public.lead_collaborators (tenant_id, lead_id, user_id)
SELECT a.tenant_id, a.entity_id, u.uid
FROM   public.audit_logs a
CROSS JOIN LATERAL (
  VALUES (a.changes->'assigned_to'->>'old'), (a.changes->'assigned_to'->>'new')
) AS v(uid_text)
CROSS JOIN LATERAL (SELECT NULLIF(v.uid_text, '')::uuid AS uid) u
WHERE  a.entity_type = 'lead'
  AND  a.changes ? 'assigned_to'
  AND  u.uid IS NOT NULL
  AND  EXISTS (SELECT 1 FROM public.leads l WHERE l.id = a.entity_id AND l.deleted_at IS NULL)
  AND  EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.uid)
ON CONFLICT (lead_id, user_id) DO NOTHING;

-- ─── 5. Logging ────────────────────────────────────────────────────────────
DO $$
DECLARE v_rows INT;
DECLARE v_unassigned_gap INT;
BEGIN
  SELECT COUNT(*) INTO v_rows FROM public.lead_collaborators;
  SELECT COUNT(*) INTO v_unassigned_gap
  FROM public.leads l
  WHERE l.assigned_to IS NOT NULL AND l.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.lead_collaborators c WHERE c.lead_id = l.id AND c.user_id = l.assigned_to);
  RAISE NOTICE '252 lead_collaborators: % rows; % active assigned leads still missing their assignee (expect 0)',
    v_rows, v_unassigned_gap;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('252_lead_assignee_is_collaborator.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

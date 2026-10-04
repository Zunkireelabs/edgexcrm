-- Migration 263: a lead's sequence follows the lead's assignee (Outreach Phase 5).
--
-- Why: the Outreach "Today" worklist shows a rep only the drafts whose assigned_to is THEM (owner/admin see all).
-- An enrollment and its pending drafts copy the lead's assignee when they are created and never update it. So when a
-- lead is reassigned — one by one, in bulk, or by the auto-router — the new owner never sees the lead's due drafts and
-- the old owner keeps drafts for a lead that is no longer theirs. A trigger keeps them in step, whichever code path
-- changes leads.assigned_to.
--
-- On a change of leads.assigned_to it copies the new assignee (NULL included: unassigned drafts are visible to admins)
-- onto the lead's RUNNING enrollments (active / paused) and PENDING drafts. Sent / skipped drafts and finished
-- enrollments keep who they were assigned to — that is history. notified_at is deliberately NOT reset: a bulk
-- reassignment of thousands of leads must not fire thousands of "draft due" bells; the new owner sees them in Today.
--
-- SECURITY DEFINER (like leads_assignee_is_collaborator, mig 252): the user who reassigns a lead may not be allowed to
-- write the sequence tables under RLS, and the sequence has to follow regardless. search_path is pinned.
--
-- Additive only: one function and one trigger; no existing row is rewritten by the migration itself.
--   Expected before/after row counts: 0 rows touched (a trigger acts on FUTURE assignee changes; no backfill).
--   Rollback: DROP TRIGGER IF EXISTS trg_leads_assignee_follows_sequences ON public.leads;
--             DROP FUNCTION IF EXISTS public.leads_assignee_follows_sequences();
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

CREATE OR REPLACE FUNCTION public.leads_assignee_follows_sequences() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.sequence_enrollments
     SET assigned_to = NEW.assigned_to
   WHERE lead_id = NEW.id
     AND status IN ('active', 'paused')
     AND assigned_to IS DISTINCT FROM NEW.assigned_to;

  UPDATE public.sequence_step_drafts
     SET assigned_to = NEW.assigned_to
   WHERE lead_id = NEW.id
     AND status = 'pending'
     AND assigned_to IS DISTINCT FROM NEW.assigned_to;

  RETURN NULL; -- AFTER trigger: the return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_assignee_follows_sequences ON public.leads;
CREATE TRIGGER trg_leads_assignee_follows_sequences
  AFTER UPDATE OF assigned_to ON public.leads
  FOR EACH ROW
  WHEN (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
  EXECUTE FUNCTION public.leads_assignee_follows_sequences();

INSERT INTO public.schema_migrations (version) VALUES ('263_sequence_follows_lead_assignee.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

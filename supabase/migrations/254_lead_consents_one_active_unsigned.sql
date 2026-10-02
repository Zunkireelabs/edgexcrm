-- Migration 254: at most ONE active unsigned consent per lead, enforced by the database.
--
-- Why: the consent "send" / "send_in_person" actions soft-delete the lead's prior unsigned row and
-- then insert a new one — three separate statements, with a signed-check before them. Two sends that
-- land at the same instant (two staff, two tabs) can both pass the checks and both insert, leaving
-- two active unsigned rows. The status route still reports the right answer (a signed row always
-- wins, see src/lib/consent/resolve-status.ts), but the lead is left with two live signing links.
-- A partial unique index closes the window: the second insert fails with a unique violation (23505),
-- which the route now turns into a clean 409 CONSENT_IN_PROGRESS.
--
-- Scope: only rows that are NOT signed and NOT soft-deleted. A lead may keep any number of signed
-- rows (manual uploads, re-signs) and any number of soft-deleted ones — those are outside the index.
-- "Unsigned" is `status <> 'signed'`, the same predicate the route uses to replace a prior row.
--
-- Pre-existing duplicates: a unique index cannot be built over them, and a failed migration blocks
-- the staging deploy (fail-closed runner). So step 1 soft-deletes all but the NEWEST active unsigned
-- row of any lead that has more than one — the same thing a resend does. It touches 0 rows when there
-- are no duplicates (dev, checked 2026-10-02: 6 active unsigned rows, 0 leads with more than one),
-- and a re-run is a no-op.
--
-- Additive in effect (an index + a guarded cleanup). Idempotent.
--   Expected before/after row counts: lead_consents row count unchanged (soft-delete only);
--     rows with deleted_at set grows by the number of duplicate unsigned rows (expected 0).
--     To see the number BEFORE applying (read-only; run on the target DB):
--       SELECT count(*) AS leads_with_duplicate_active_unsigned FROM (
--         SELECT lead_id FROM lead_consents
--         WHERE deleted_at IS NULL AND status <> 'signed'
--         GROUP BY lead_id HAVING count(*) > 1) d;
--   Rollback: DROP INDEX IF EXISTS public.uq_lead_consents_one_active_unsigned;
--             (soft-deleted duplicates, if any, can be restored by clearing deleted_at on the rows
--              whose id/created_at you want back — but the index must be dropped first.)
--   Applied: stage <PENDING> / prod HELD.

BEGIN;

-- ─── 1. Resolve any existing duplicates (keep the newest, soft-delete the rest) ─────────────
UPDATE public.lead_consents c
SET    deleted_at = now()
WHERE  c.deleted_at IS NULL
  AND  c.status <> 'signed'
  AND  EXISTS (
         SELECT 1 FROM public.lead_consents n
         WHERE  n.lead_id = c.lead_id
           AND  n.deleted_at IS NULL
           AND  n.status <> 'signed'
           AND  (n.created_at, n.id) > (c.created_at, c.id)
       );

-- ─── 2. One active unsigned consent per lead ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_consents_one_active_unsigned
  ON public.lead_consents (lead_id)
  WHERE deleted_at IS NULL AND status <> 'signed';

INSERT INTO public.schema_migrations (version) VALUES ('254_lead_consents_one_active_unsigned.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

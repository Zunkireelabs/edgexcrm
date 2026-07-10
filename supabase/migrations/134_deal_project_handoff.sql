-- Migration 134: Deal/Proposal -> Project handoff — bind proposals to the
-- (renumbered from 129 at merge: origin/stage independently took 129 with
--  129_fix_lead_branches_assigned_desync.sql while this branch was in flight.)
-- project they seeded, and give projects a currency to make budget_amount /
-- default_rate unambiguous.
--
-- Additive only. Expected before/after row counts: 0 rows touched (column adds
-- only; no backfill — existing rows get NULL, which is correct: they weren't
-- seeded from a proposal).
-- Rollback:
--   ALTER TABLE proposals DROP COLUMN IF EXISTS project_id;
--   ALTER TABLE projects DROP COLUMN IF EXISTS currency;
-- Applied: stage <PENDING> / prod HELD.

BEGIN;

-- Bind a seeded project back to the specific accepted proposal it was built from
-- (COO gap #2: "see the SOW you're delivering against"). Nullable; SET NULL on delete.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_id UUID
  REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON proposals(project_id);

-- projects has no currency column; budget_amount/default_rate are ambiguous without one.
-- Additive, nullable; seeded from the proposal/deal at conversion. (Tier 2 margin needs this too.)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS currency TEXT;

-- REQUIRED self-record (Migration Guard, mig 123 convention)
INSERT INTO public.schema_migrations (version) VALUES ('134_deal_project_handoff.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

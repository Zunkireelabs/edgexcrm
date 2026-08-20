-- Migration 210: leads.collaborator_count — denormalized counter for the
-- Collaborators "is empty" filter.
--
-- Why: PostgREST's embedded !inner join (used for the Collaborators "is any
-- of"/"is not empty" filters — see src/lib/filters/registry/leads.ts) can only
-- express "at least one matching row exists". It structurally cannot express
-- "no matching row exists" — that needs a NOT EXISTS-shaped query, which a
-- single PostgREST filter string cannot produce. The alternative (fetch every
-- lead_id that HAS a collaborator, then .not("id","in",...) the main leads
-- query) was rejected: this exact codebase already hit a real incident from a
-- caller-built .in()/.not("in") id array getting too large for the URL (see
-- route.ts's "300-id visibility bug" comment) — a few users here hold 1000+
-- collaborator leads each, so the excluded-id list could easily repeat it.
--
-- A denormalized counter, kept in sync by a trigger on lead_collaborators,
-- turns "is empty" into a plain, fast, indexed column check with no join and
-- no unbounded id list. It does NOT solve "is none of" (exclude specific
-- people) — a count alone can't tell you WHO the collaborators are — that
-- still needs the harder fix and stays out of scope here.
--
-- Additive only. Expected before/after row counts: leads row count unchanged
-- (0 rows added/removed); every existing leads row gets collaborator_count
-- backfilled to its real lead_collaborators row count (0 for leads with none,
-- which is also the column's DEFAULT so no explicit UPDATE is needed for them).
-- Rollback: DROP TRIGGER IF EXISTS trg_lead_collaborators_sync_count ON lead_collaborators;
--           DROP FUNCTION IF EXISTS lead_collaborators_sync_count();
--           DROP INDEX IF EXISTS idx_leads_no_collaborators;
--           ALTER TABLE leads DROP COLUMN IF EXISTS collaborator_count;
-- Applied: stage HELD / prod HELD.

BEGIN;

-- ─── 1. Column ──────────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS collaborator_count INTEGER NOT NULL DEFAULT 0;

-- Targeted partial index — the only query shape this column exists for is
-- "leads with zero collaborators", so index just that slice.
CREATE INDEX IF NOT EXISTS idx_leads_no_collaborators
  ON leads (tenant_id)
  WHERE collaborator_count = 0 AND deleted_at IS NULL;

-- ─── 2. Backfill ────────────────────────────────────────────────────────────
-- Idempotent: only touches rows whose count is actually wrong, so a re-run is
-- a no-op. Leads with zero lead_collaborators rows already read 0 from the
-- column DEFAULT above — nothing to backfill for them.
UPDATE leads l
SET collaborator_count = sub.cnt
FROM (
  SELECT lead_id, COUNT(*) AS cnt
  FROM lead_collaborators
  GROUP BY lead_id
) sub
WHERE l.id = sub.lead_id
  AND l.collaborator_count IS DISTINCT FROM sub.cnt;

-- ─── 3. Trigger — keep the counter in sync going forward ───────────────────
-- lead_collaborators (mig 090) is insert/delete only (no UPDATE path in the
-- app), so only those two ops need handling. GREATEST(...,0) is a defensive
-- floor only — the UNIQUE(lead_id,user_id) constraint + FK cascades mean it
-- should never actually be needed.
CREATE OR REPLACE FUNCTION lead_collaborators_sync_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE leads SET collaborator_count = collaborator_count + 1 WHERE id = NEW.lead_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE leads SET collaborator_count = GREATEST(collaborator_count - 1, 0) WHERE id = OLD.lead_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_collaborators_sync_count ON lead_collaborators;
CREATE TRIGGER trg_lead_collaborators_sync_count
  AFTER INSERT OR DELETE ON lead_collaborators
  FOR EACH ROW EXECUTE FUNCTION lead_collaborators_sync_count();

-- ─── 4. Logging ─────────────────────────────────────────────────────────────
DO $$
DECLARE v_nonzero INT;
DECLARE v_total INT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE collaborator_count > 0), COUNT(*) INTO v_nonzero, v_total FROM leads;
  RAISE NOTICE '210 leads.collaborator_count: % of % leads have >=1 collaborator after backfill', v_nonzero, v_total;
END$$;

INSERT INTO public.schema_migrations (version) VALUES ('210_leads_collaborator_count.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

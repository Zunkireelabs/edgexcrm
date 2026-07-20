-- Migration 155: it_agency — drain legacy (pre-funnel) lead_lists into Lead Processing / Raw
--
-- DESTRUCTIVE. Mig 154 split it_agency Leads into two funnels (lead_processing,
-- sales_leads) but left pre-existing generic lists (e.g. "New Leads"/"Contacted"/
-- "Qualified") untouched with funnel_key=NULL. That's a 3rd, ungrouped "All Leads"
-- bucket in the sidebar and a flat section in Settings. Decision: move every lead on
-- a legacy list into Lead Processing -> Raw (status "Imported"), make Raw the sole
-- intake list, then delete the now-empty legacy lists (+ their per-list pipeline).
--
-- Legacy selector (per it_agency tenant): funnel_key IS NULL AND is_archive = false
-- AND slug <> 'delete'. Snapshot-first (regardless of deleted_at) into
-- _mig155_rollback before any mutation. Naturally idempotent: after the first run no
-- lead_lists row matches the legacy selector anymore, so every step (snapshot, move,
-- intake flip, delete) resolves to 0 rows on re-run.
--
-- Also discovered mid-build (local dry run): 106 Zunkiree Labs leads sitting in the
-- "Delete" list (funnel_key NULL but slug='delete', deliberately excluded from the
-- drain) still carried a STALE pipeline_id/stage_id pointing at the legacy "New
-- Leads" pipeline — never synced when they were moved to Delete. That's pre-existing
-- drift, unrelated to this feature, but it blocks dropping the legacy pipelines (FK).
-- Fixed generically here: any lead whose pipeline_id references a legacy pipeline but
-- whose list_id points at some OTHER (non-legacy) list gets repaired onto ITS OWN
-- current list's pipeline landing stage — list_id is untouched, only the stale
-- pipeline_id/stage_id/status pointer is corrected.
--
-- Expected before/after row counts (local, verified 2026-07-14):
--   _mig155_rollback: +934 drained (Zunkiree Labs: Contacted 186 + New Leads 477
--     active + 1 soft-deleted + Qualified 270) + 106 drift-repaired (Delete list) = 1040
--   leads: 934 rows repointed to Raw list/pipeline/stage, status='imported';
--     106 rows repaired onto Delete's own pipeline/stage (list_id unchanged)
--   lead_lists: -3 per tenant with legacy lists (New Leads/Contacted/Qualified)
--   pipelines: -3 per such tenant (their dedicated per-list pipelines)
--   pipeline_stages: -12 per such tenant (4 stages x 3 legacy pipelines)
-- Rollback (manual, from _mig155_rollback — lists/pipelines are NOT recreated):
--   UPDATE leads l SET list_id = r.old_list_id, stage_id = r.old_stage_id,
--     pipeline_id = r.old_pipeline_id, status = r.old_status
--   FROM _mig155_rollback r WHERE l.id = r.lead_id;
--   -- then manually re-seed the deleted lead_lists/pipelines/pipeline_stages rows
--   -- (schema, not data, is recoverable from mig 059/committed history) and restore
--   -- is_intake on the original list.
-- Applied: local 2026-07-14 / stage <PENDING> / prod HELD.

BEGIN;

-- ─── 0. Guard: every tenant with legacy lists must already have a resolvable
--        Raw list + "imported" stage (mig 154 applied). Fail loudly, not silently,
--        so a future stage/prod apply can't skip a tenant unnoticed. ────────────

DO $$
DECLARE
  v_missing_raw INT;
BEGIN
  SELECT COUNT(DISTINCT ll.tenant_id) INTO v_missing_raw
  FROM lead_lists ll
  JOIN tenants t ON t.id = ll.tenant_id AND t.industry_id = 'it_agency'
  WHERE ll.funnel_key IS NULL AND ll.is_archive = false AND ll.slug <> 'delete'
    AND NOT EXISTS (
      SELECT 1
      FROM lead_lists raw
      JOIN pipeline_stages rs ON rs.pipeline_id = raw.pipeline_id AND rs.slug = 'imported'
      WHERE raw.tenant_id = ll.tenant_id AND raw.funnel_key = 'lead_processing' AND raw.slug = 'raw'
    );

  IF v_missing_raw > 0 THEN
    RAISE EXCEPTION '155 ABORT: % it_agency tenant(s) have legacy lists but no resolvable Raw/imported stage — apply mig 154 first', v_missing_raw;
  END IF;
END$$;

-- ─── 1. Rollback snapshot table (persists after COMMIT — not a temp table) ──────

CREATE TABLE IF NOT EXISTS _mig155_rollback (
  lead_id         UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  old_list_id     UUID,
  old_stage_id    UUID,
  old_pipeline_id UUID,
  old_status      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. Resolve legacy lists + each tenant's Raw list/pipeline/landing stage ────

DROP TABLE IF EXISTS _mig155_legacy;
CREATE TEMP TABLE _mig155_legacy AS
SELECT
  ll.id           AS legacy_list_id,
  ll.pipeline_id  AS legacy_pipeline_id,
  ll.tenant_id    AS tenant_id,
  raw.id          AS raw_list_id,
  raw.pipeline_id AS raw_pipeline_id,
  rs.id           AS raw_stage_id,
  rs.slug         AS raw_stage_slug
FROM lead_lists ll
JOIN tenants t ON t.id = ll.tenant_id AND t.industry_id = 'it_agency'
JOIN lead_lists raw ON raw.tenant_id = ll.tenant_id AND raw.funnel_key = 'lead_processing' AND raw.slug = 'raw'
JOIN pipeline_stages rs ON rs.pipeline_id = raw.pipeline_id AND rs.slug = 'imported'
WHERE ll.funnel_key IS NULL AND ll.is_archive = false AND ll.slug <> 'delete';

-- ─── 3. Logging: before counts ──────────────────────────────────────────────

DO $$
DECLARE
  v_legacy_lists   INT;
  v_affected_leads INT;
BEGIN
  SELECT COUNT(*) INTO v_legacy_lists FROM _mig155_legacy;
  SELECT COUNT(*) INTO v_affected_leads FROM leads WHERE list_id IN (SELECT legacy_list_id FROM _mig155_legacy);
  RAISE NOTICE '155 BEFORE: % legacy lists, % leads pointing at them (any deleted_at)', v_legacy_lists, v_affected_leads;
END$$;

-- ─── 4. Snapshot affected leads (regardless of deleted_at) before mutating ──────
--        Covers both: (a) leads actually on a legacy list (about to be drained to
--        Raw) and (b) drift-repair leads — living on some OTHER list already, but
--        with a stale pipeline_id/stage_id still referencing a legacy pipeline.

INSERT INTO _mig155_rollback (lead_id, tenant_id, old_list_id, old_stage_id, old_pipeline_id, old_status)
SELECT l.id, l.tenant_id, l.list_id, l.stage_id, l.pipeline_id, l.status
FROM leads l
WHERE l.list_id IN (SELECT legacy_list_id FROM _mig155_legacy)
   OR (
        l.pipeline_id IN (SELECT legacy_pipeline_id FROM _mig155_legacy)
        AND l.list_id NOT IN (SELECT legacy_list_id FROM _mig155_legacy)
      )
ON CONFLICT (lead_id) DO NOTHING;

-- ─── 5. Move leads onto Raw: list_id + pipeline_id + stage_id + status together ─
--        (all four are coupled everywhere the app moves a lead between lists —
--        see getPipelineLandingStage() call sites in leads/route.ts + bulk/route.ts)

UPDATE leads l
SET
  list_id     = lg.raw_list_id,
  pipeline_id = lg.raw_pipeline_id,
  stage_id    = lg.raw_stage_id,
  status      = lg.raw_stage_slug
FROM _mig155_legacy lg
WHERE l.list_id = lg.legacy_list_id;

-- ─── 5b. Drift repair: leads NOT on a legacy list but still pointing (via a stale
--         pipeline_id) at a legacy pipeline. Does not touch list_id — only syncs
--         pipeline_id/stage_id/status onto the lead's CURRENT list's own landing
--         stage, so the legacy pipeline can be dropped without an FK violation.

UPDATE leads l
SET
  pipeline_id = ll.pipeline_id,
  stage_id    = landing.id,
  status      = landing.slug
FROM lead_lists ll
CROSS JOIN LATERAL (
  SELECT ps.id, ps.slug
  FROM pipeline_stages ps
  WHERE ps.pipeline_id = ll.pipeline_id
  ORDER BY ps.is_default DESC, ps.position ASC
  LIMIT 1
) landing
WHERE l.list_id = ll.id
  AND ll.pipeline_id IS NOT NULL
  AND l.pipeline_id IN (SELECT legacy_pipeline_id FROM _mig155_legacy)
  AND l.list_id NOT IN (SELECT legacy_list_id FROM _mig155_legacy);

-- ─── 6. Preserve intake: Raw becomes the sole is_intake=true list per tenant ────

UPDATE lead_lists ll
SET is_intake = (ll.id = lg.raw_list_id)
FROM (SELECT DISTINCT tenant_id, raw_list_id FROM _mig155_legacy) lg
WHERE ll.tenant_id = lg.tenant_id
  AND ll.is_intake <> (ll.id = lg.raw_list_id);

-- ─── 6b. Guard: no lead may still reference a legacy pipeline/stage before we drop
--         it. Catches the edge case where a drift-repair target list's pipeline had
--         zero pipeline_stages (the LATERAL returned no landing row → that lead was
--         skipped), which would otherwise surface as a cryptic FK error on the
--         DELETEs below. Fail loud with a clear message instead.

DO $$
DECLARE
  v_residual INT;
BEGIN
  SELECT COUNT(*) INTO v_residual
  FROM leads l
  WHERE l.pipeline_id IN (SELECT legacy_pipeline_id FROM _mig155_legacy)
     OR l.stage_id IN (
          SELECT ps.id FROM pipeline_stages ps
          JOIN _mig155_legacy lg ON lg.legacy_pipeline_id = ps.pipeline_id
        );
  IF v_residual > 0 THEN
    RAISE EXCEPTION '155 ABORT: % lead(s) still reference a legacy pipeline/stage after drain+drift-repair (likely a current-list pipeline with no pipeline_stages) — resolve before dropping legacy pipelines', v_residual;
  END IF;
END$$;

-- ─── 7. Delete the now-empty legacy lists: stages -> pipelines -> lists ─────────
--        (leads_pipeline_id_fkey is ON DELETE NO ACTION — if any lead were somehow
--        still pointing at a legacy pipeline, this delete errors and the whole
--        transaction rolls back rather than silently orphaning data.)

DELETE FROM pipeline_stages
WHERE pipeline_id IN (SELECT p.id FROM pipelines p JOIN _mig155_legacy lg ON lg.legacy_list_id = p.list_id);

DELETE FROM pipelines
WHERE list_id IN (SELECT legacy_list_id FROM _mig155_legacy);

DELETE FROM lead_lists
WHERE id IN (SELECT legacy_list_id FROM _mig155_legacy);

-- ─── 8. Logging: after counts ───────────────────────────────────────────────────

DO $$
DECLARE
  v_snapshot_total     INT;
  v_remaining_legacy   INT;
  v_raw_leads          INT;
BEGIN
  SELECT COUNT(*) INTO v_snapshot_total FROM _mig155_rollback;
  SELECT COUNT(*) INTO v_remaining_legacy
    FROM lead_lists ll JOIN tenants t ON t.id = ll.tenant_id AND t.industry_id = 'it_agency'
    WHERE ll.funnel_key IS NULL AND ll.is_archive = false AND ll.slug <> 'delete';
  SELECT COUNT(*) INTO v_raw_leads
    FROM leads l JOIN lead_lists ll ON ll.id = l.list_id
    WHERE ll.funnel_key = 'lead_processing' AND ll.slug = 'raw' AND l.deleted_at IS NULL;
  RAISE NOTICE '155 AFTER: % total snapshotted, % legacy lists remaining (expect 0), % active leads now on Raw', v_snapshot_total, v_remaining_legacy, v_raw_leads;
END$$;

-- REQUIRED: self-record in the ledger (mig 123).
INSERT INTO public.schema_migrations (version) VALUES ('155_it_agency_drain_legacy_lists.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;

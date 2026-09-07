# BRIEF — Leads Organise PHASE 4 (Existing Leads → staging; clean main list) — for Sonnet

> **Role:** Executor. Two migrations on the EXISTING branch `feature/leads-organise` (latest `95d3fee`).
> Apply to the **STAGE DB only** (`dymeudcddasqpomfpjvt`), in transactions with before/after counts.
> Commit, then **STOP and report**. Do NOT push, PR, merge, or touch prod. **No app code changes are
> expected** — the generic Leads Organise infra already handles nav, cockpit page, merge-gating, source
> filter, and bulk-promote for any `is_staging` list. **Sadin verifies the UI himself.**

## Intent
Pull the leads that were already in edgeX before the migration (the ~419 non-migration leads) OUT of the
main "All Leads" pipeline into a NEW staging list, so the **main list starts completely clean** and the
client promotes everything deliberately. Decision (locked): **move ALL ~419** (Pre-qualified, Prospects,
Applications, null). The ~7 organized leads lose their stage position; that's accepted. Applications/
classes/notes stay attached to the lead (separate tables), so nothing of substance is lost.

## Context (verified on stage)
- Migration leads are 100% in `migration-qc` (6,114) → automatically excluded.
- The ~419 existing edgeX leads sit in: Pre-qualified ~407, Prospects 6, Applications 1, null 5. Sources
  are non-migration (`api`/`form`/`worldcup-predict-win`/`manual_entry`/`null`).
- Admizz tenant: `febeb37c-521c-4f29-adbb-0195b2eede88`.

## 1. Migration `071_existing_leads_staging.sql` — create the staging list
Insert one `lead_lists` row for the Admizz tenant (additive, idempotent):
```sql
INSERT INTO lead_lists (tenant_id, name, slug, sort_order, is_system, is_archive, is_intake, is_staging, access)
VALUES ('febeb37c-521c-4f29-adbb-0195b2eede88',
        'Existing Leads (edgeX)', 'existing-leads-edgex', 7, false, false, false, true,
        '{"mode":"all"}'::jsonb)
ON CONFLICT (tenant_id, slug) DO NOTHING;
```
(sort_order 7 = after migration-qc's 6; staging lists are outside the lifecycle so it only affects nav order.
Adjust column list to match the live `lead_lists` schema.)

## 2. SAFETY SNAPSHOT (before the move) — for reversibility
Because the move overwrites each lead's `list_id` and we are NOT storing the origin, FIRST capture a
reversal map and save it (paste into the report + keep the file):
```sql
SELECT id, list_id AS original_list_id
FROM leads
WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88'
  AND deleted_at IS NULL AND converted_at IS NULL
  AND (list_id IS NULL OR list_id IN (
        SELECT id FROM lead_lists
        WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND NOT is_staging AND NOT is_archive));
```
This is the undo set (lead_id → where it was). Required before step 3.

## 3. Migration `072_move_existing_leads_to_staging.sql` — move them (STAGE only)
In a transaction with before/after counts:
```sql
BEGIN;
-- before: main-view count + target-list count
SELECT COUNT(*) AS main_view_before FROM leads l
  LEFT JOIN lead_lists ll ON l.list_id=ll.id
  WHERE l.tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND l.deleted_at IS NULL AND l.converted_at IS NULL
    AND (ll.slug IS NULL OR (NOT ll.is_staging AND NOT ll.is_archive));

UPDATE leads
SET list_id = (SELECT id FROM lead_lists
               WHERE slug='existing-leads-edgex' AND tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88')
WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88'
  AND deleted_at IS NULL AND converted_at IS NULL
  AND (list_id IS NULL OR list_id IN (
        SELECT id FROM lead_lists
        WHERE tenant_id='febeb37c-521c-4f29-adbb-0195b2eede88' AND NOT is_staging AND NOT is_archive));

-- after: target list should hold ~419; main view should be 0
SELECT COUNT(*) AS existing_staging_after FROM leads l JOIN lead_lists ll ON l.list_id=ll.id
  WHERE ll.slug='existing-leads-edgex' AND l.deleted_at IS NULL;
COMMIT;
```
Notes:
- Do NOT touch `lead_type` (leave as-is; staging ignores it, re-promote will set it).
- Do NOT move converted, deleted, archived, or `migration-qc` leads (the WHERE clause already excludes them).
- This is **Admizz-tenant-scoped and STAGE-only**. It will empty Admizz's main pipeline on stage.

## Verification (Sadin does UI; you do data + gates)
- `npm run build` clean · `npx eslint --max-warnings 50` clean (should be no code changes, but run anyway).
- On stage confirm: `existing-leads-edgex` list exists with `is_staging=true`; it holds ~419 leads; the
  main-view count is now 0; `migration-qc` still 6,114.
- Sadin will confirm in dev: **Leads Organise** now shows TWO children (Migration List + Existing Leads
  (edgeX)); All Leads is empty; the Existing Leads cockpit shows the table (no reconciliation panel, which
  is correct — no source files) with source filter + Move-to-list working and Merge hidden.

## Report, then STOP
Commit hash, the two migration files, the SAFETY SNAPSHOT result (the undo set), before/after counts, gate
outputs. Do NOT push/PR/merge/prod — Opus reviews, then drives the combined push to stage.

## PROD caveat (not now)
On the eventual prod replay this empties the LIVE client pipeline — must run the safety snapshot there too,
and confirm with Sadin before executing. Tracked for the prod-promotion checklist.

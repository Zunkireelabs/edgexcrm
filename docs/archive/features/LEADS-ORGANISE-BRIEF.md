# BRIEF — Leads Organise (MVP) — for Sonnet

> **Role:** You are the executor. Build the MVP described here, then **STOP at review** — do NOT
> push, do NOT open a PR, do NOT merge, do NOT apply migrations to any shared DB beyond the local/stage
> verification steps explicitly listed. Produce a report; Opus reviews independently before anything ships.
> (This has been violated before — please respect the gate this time.)

Full approved plan (phases 2 & 3 included): `~/.claude/plans/leave-ti-now-whimsical-hammock.md`.
This brief is **MVP / Phase 1 only**.

---

## What you're building

A permanent, generic **staging cockpit** called **"Leads Organise"**. Clients dump imported/migrated
leads into a *staging list*; staff bulk-route chunks into the live pipeline lists. First instance is
the existing Admizz "Migration (QC)" list (6,114 leads, slug `migration-qc`).

**Hard constraints:** efficient, no schema bloat, no many-to-many. Routing = MOVE (single
`leads.list_id` changes → lead leaves staging → staging drains to zero).

---

## Scope of THIS MVP (5 items, in order)

### 1. Migration `067_staging_lists.sql` (additive, reversible)
- `ALTER TABLE lead_lists ADD COLUMN IF NOT EXISTS is_staging BOOLEAN NOT NULL DEFAULT false;`
- `UPDATE lead_lists SET is_staging = true WHERE slug = 'migration-qc';` (tenant-scoped to Admizz; verify it only hits that one row)
- Header comment with rollback: `ALTER TABLE lead_lists DROP COLUMN IF EXISTS is_staging;`
- Add `is_staging?: boolean` to the `LeadList` type in `src/types/database.ts`.
- **Apply to STAGE only** (`dymeudcddasqpomfpjvt`) in a txn with before/after counts. NOT prod.

### 2. Hide staging from "All Leads"
- `src/app/(main)/(dashboard)/leads/page.tsx`: where `excludeListIds` is built from archive lists, extend it to `is_archive OR is_staging`. Single-list-by-slug views unaffected.
- `src/app/(main)/(dashboard)/layout.tsx`: split lead lists into `pipelineLists` (`!is_staging`) and `stagingLists` (`is_staging`). Pass `stagingLists` as a NEW prop to `DashboardShell`; pass only `pipelineLists` to the existing All-Leads nav prop so staging lists drop out of that group.

### 3. Bulk move-to-list endpoint (the core build)
Modify `src/app/(main)/api/v1/leads/bulk/route.ts` PATCH to accept `{ list_id, archive_reason? }`
alongside the existing `assigned_to`/`branch_id`. **Port the validation from the single-lead route**
`src/app/(main)/api/v1/leads/[id]/route.ts` (the `list_id` block, ~lines 307–478):
- Feature gate `getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)` → `apiForbidden()`.
- Resolve target list by `tenant_id + id`; run `canAccessList(auth.permissions, list.access, auth.positionId)` → forbidden if false.
- If target `is_archive` and no `archive_reason` → validation error (applied to whole chunk).
- Mirror `lead_type`: target slug `prospects` → `'prospect'`, else `'lead'`.
- Add `list_id` to the `existingLeads` SELECT (so old value is captured) and to `bulkUpdatePayload`.
- Emit per-lead `lead.list_changed` event with `old_list_id`/`new_list_id`/`archive_reason`, plus the audit `lead.updated` with `{list:{old,new}}` — mirror the single-lead pattern.
- **Keep the 100-id cap.** Move-only calls must SKIP the assignment-notification path (it's already keyed off `body.assigned_to`, so just don't trigger it when only `list_id` is sent).
- Keep all tenant filters explicit (`.eq("tenant_id", auth.tenantId)` on the list lookup and lead update).

### 4. Bulk "Move to list" UI
- `src/components/dashboard/leads/move-to-list-selector.tsx`: extract the list-picker + archive-reason sub-UI into a shareable piece (or add a `bulk` variant) so both per-row and bulk reuse it.
- `src/components/dashboard/leads-table.tsx`: add an admin-gated **"Move to list"** button to the bulk action bar (only when there are move-target lists). On confirm → `handleBulkMove()` that loops the selected (filtered) ids in chunks of 100 → POST `/api/v1/leads/bulk` with `{ ids, list_id, archive_reason? }`, show a progress toast, then `router.refresh()`. Follow the existing `handleBulkAssign` pattern for selection/filtering.

### 5. Nav + pages (admin/manager gated)
- `src/components/dashboard/leads-organise-nav-group.tsx` — NEW universal expandable nav group, modeled closely on `src/components/dashboard/lead-lists-nav-group.tsx`. Parent links to `/leads-organise`; children = staging lists linking to `/leads-organise/{slug}`; active state via `pathname.startsWith("/leads-organise")`.
- `src/components/dashboard/shell.tsx` — accept the new `stagingLists` prop; render `<LeadsOrganiseNavGroup>` in the `UNIVERSAL_NAV_TOP` flow **before** the `/leads` (All Leads) branch, only when `stagingLists.length > 0`. Allow `/leads-organise` as a recognized nav key.
- `src/app/(main)/(dashboard)/leads-organise/page.tsx` — index listing staging lists with their lead counts. Admin/manager only; `redirect("/dashboard")` otherwise.
- `src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx` — the cockpit. **Mirror `leads/page.tsx` data fetch**: resolve `slug` → staging list, `canAccessList`, `getLeads(tenantId, { ...scope, listId: stagingList.id, limit: 50000 })`. Render the reused `<LeadsTable>` with: `leadLists` = the accessible **pipeline (non-staging)** lists as move targets, the source filter enabled. Admin/manager gated.

**Not in MVP** (later phases, do NOT build now): reconciliation panel + `lead_import_sources` table (Phase 2), prev-assignee role column (Phase 2), smart suggested-routing panel (Phase 3), per-lead raw snapshot (deferred). The MVP cockpit shows the leads + lets you bulk-move them; the proof panel comes in Phase 2.

---

## Conventions (must follow)
- New/changed API code: `authenticateRequest()` → feature gate → explicit `.eq("tenant_id", auth.tenantId)` (or `scopedClient`). Counselor scoping preserved.
- Branch off latest `origin/stage`. Migrations applied to **STAGE DB only** for verification, never prod.
- Universal feature (not industry-scoped): gate visibility on `stagingLists.length > 0` + admin, so non-education tenants simply never see it.

## Gates before you report (run them, paste output)
1. `npm run build` — clean.
2. `npx eslint --max-warnings 50` — clean.
3. Local `npm run dev` as Admizz admin (`admizzdotcom2020@gmail.com` / `admizz123` on stage DB):
   - Sidebar: **Leads Organise › Migration List** appears above All Leads.
   - All Leads master view no longer shows the 6,114 staging leads.
   - Open Migration List → leads render (reused table, source filter works).
   - Select a chunk → **Move to list → Pre-Qualify** → leads leave staging, land in the target list; audit timeline shows the list change.
   - As a counselor/viewer: Leads Organise nav hidden; visiting `/leads-organise/*` redirects.
   - No regressions on All Leads, pipeline, single-lead move, existing bulk assign.

## Report back (then STOP)
- The diff/branch name, migration SQL, gate outputs, and screenshots/notes from the manual run.
- Any deviation from this brief and why.
- **Do not push, PR, merge, or touch prod.** Opus reviews independently and drives the stage push.

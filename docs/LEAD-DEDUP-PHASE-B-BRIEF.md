# Brief — Lead Dedup Phase B: merge engine + backfill + merge UI

> **Executor:** Sonnet. **Reviewer/merger:** Opus (Sadin pastes this to Sonnet).
> **Parent design:** `~/.claude/plans/what-i-want-to-floofy-shore.md` + `docs/reference` n/a.
> **Prereq:** Phase A is merged + verified (it is — verified locally 2026-06-05, on stage).
> Schema from migration `033` (already on shared DB): `lead_merges`, `lead_duplicate_suggestions`,
> `leads.merged_into` all exist. **No new migration needed unless noted.**

## Why

Phase A stops NEW duplicates. Phase B cleans the ones already in the DB (24 live
duplicate email-groups tenant-wide, incl. ~9 "sadin shrestha") and gives admins an
ongoing manual-merge tool + phone-duplicate suggestions. **This phase is destructive
(soft-deletes + re-points foreign keys + merges fields) — the hard rule is NO DATA LOSS
and full reversibility.**

## HARD RULES

1. **No data loss.** Before a lead is absorbed, its own field values are preserved as a
   synthesized `lead_submissions` row (`created_via='backfill'` or `'manual'`,
   `raw_payload` = the absorbed lead's snapshot). Every re-point is recorded in
   `lead_merges.repointed_counts` + the exact field changes in `lead_merges.field_patch`
   so an **undo** can fully reverse it.
2. **Backfill defaults to DRY-RUN.** It must NEVER mutate without an explicit
   `--apply` flag. Opus + Sadin review the dry-run report before any apply.
3. **Local verification before push** (per the standing rule). See the verification
   section — test the merge primitive on SYNTHETIC leads in the **Zunkiree Labs** tenant
   (`a0000000-0000-0000-0000-000000000001`), never on customer (Admizz) data, until proven.
4. **Stop at review after B1** (merge primitive + its local test). Do NOT run the backfill
   apply on real data — that's Opus+Sadin's call after reviewing the dry-run.

## Commit B1 — merge primitive + API (`src/lib/leads/merge.ts`)

A single function `mergeLeads(supabase, { tenantId, canonicalId, absorbedId, mergedBy, source })`
used by the live merge API, the undo, and the backfill. Steps (study `dedup.ts`'s
`applyCanonicalUpdate` and reuse it):

1. Load both leads via service client; assert same `tenant_id`, both `deleted_at IS NULL`,
   `canonicalId !== absorbedId`, and **reject if either has `converted_at` set** (don't
   merge converted leads).
2. **Synthesize a `lead_submissions` row** for the absorbed lead's current values
   (`recordSubmission`, `matchedExisting:true`, `raw_payload` = absorbed snapshot) so its
   data is preserved verbatim under the canonical.
3. **Re-point every `lead_id` FK** absorbed→canonical (counts captured per table):
   - Plain UPDATE: `lead_submissions`, `lead_notes`, `lead_checklists`, `lead_activities`,
     `tasks` (SET NULL FK), `email_threads` (SET NULL FK).
   - `lead_insights` has **`UNIQUE(lead_id)`** → if canonical already has a row, DELETE the
     absorbed's insight (AI-regenerable); else re-point.
   - `audit_logs` and `events` where `entity_type='lead' AND entity_id=absorbedId` → set
     `entity_id=canonicalId` (history follows the canonical).
4. **Merge fields** into canonical via `applyCanonicalUpdate(canonical, absorbedAsIncoming)`
   (fill-empty; custom_fields/file_urls merge existing-wins; tags union). Capture the patch.
5. **Soft-delete absorbed**: `deleted_at=now()`, `merged_into=canonicalId`.
6. **Write `lead_merges`** row: `{tenant_id, canonical_id, absorbed_id, merged_by, source,
   repointed_counts, field_patch}`.
7. `createAuditLog({action:'lead.merged', entityId:canonicalId, changes:{absorbed_id:{old:absorbedId,new:null}}})`
   + `emitEvent('lead.merged')`. Notify canonical's `assigned_to` (or admins) via
   `upsertThreadNotification` (reuse the dedup-path notification pattern).
8. Return `{ canonicalId, repointedCounts }`.

**`undo(supabase, mergeId)`**: read `lead_merges`; re-point all children back to
`absorbed_id`; clear `absorbed.deleted_at`/`merged_into`; revert the recorded `field_patch`
on canonical where it still holds the merged value; delete the synthesized backfill
submission; mark the merge row undone (add `undone_at` — needs a tiny migration `034`, OR
just delete the `lead_merges` row and log an audit). Recommend a `034` adding
`lead_merges.undone_at TIMESTAMPTZ` for a clean audit trail.

**API routes** (admin-gated — `authenticateRequest` + `is_tenant_admin`, follow
`leads/route.ts` patterns; use `scopedClient(auth)` to load/authorize then `.raw()` for the
cross-row service writes):
- `POST /api/v1/leads/merge` body `{ canonical_id, absorbed_id }` → `mergeLeads(... source:'manual', mergedBy:auth.userId)`.
- `POST /api/v1/leads/merge/[mergeId]/undo` → `undo`.

## Commit B2 — merge UI + duplicate suggestions

- **Phone suggestions:** Phase A's `resolveLeadIdentity` returns `phoneMatchLeadIds` but the
  routes don't yet persist them. Wire the ingestion paths to upsert
  `lead_duplicate_suggestions` (`reason:'phone'`, `status:'open'`) for those matches.
  (Small addition to the A3 routes.)
- **Merge dialog** `src/components/dashboard/lead/merge-dialog.tsx`: side-by-side field
  diff of two leads, radio to choose canonical (default = older), "Merge" → POST. Reuse
  shadcn Dialog/Button.
- **Entry points:** leads-list multi-select → "Merge" action (2 selected); a "Possible
  duplicates" card on the lead detail page listing open `lead_duplicate_suggestions` →
  opens the merge dialog prefilled; a "Dismiss" action (PATCH suggestion → `dismissed`).

## Commit B3 — backfill (`src/lib/leads/backfill.ts` + `scripts/dedup-backfill.ts`)

A library function + a thin local script (run via `npx tsx scripts/dedup-backfill.ts`),
**dry-run by default, `--apply` to mutate, `--tenant <id>` to scope, `--undo` to reverse**:

- **Group** live leads by `(tenant_id, normalized_email)` where `email` non-empty,
  `deleted_at IS NULL`, `is_final=true`, `merged_into IS NULL`, `count > 1`.
- Canonical = oldest `created_at` (ties → lowest id).
- **Dry-run:** print total groups, total dup leads, and a sample (≤20) of groups with the
  field values that WOULD change on each canonical + child-row counts that would re-point.
  **No writes.**
- **Apply:** for each non-canonical in each group, call `mergeLeads(... source:'backfill')`.
  **Idempotent** — skip leads already `merged_into IS NOT NULL`; re-running only picks up
  still-open groups.
- **Undo:** iterate `lead_merges WHERE source='backfill'` newest-first → `undo`.

**After a clean full backfill apply**, the race-backstop unique index can finally be
created (it failed in `033` due to the dupes). Add it as migration `034` (or include with
the `undone_at` column): `CREATE UNIQUE INDEX uq_leads_tenant_norm_email ON leads
(tenant_id, normalized_email) WHERE normalized_email IS NOT NULL AND deleted_at IS NULL AND
is_final = true;` — **only run on shared DB after backfill confirms zero live dup groups.**

## Verification (LOCAL first, per the rule)

**B1 merge primitive (synthetic, Zunkiree Labs tenant):**
1. Via `npm run dev` + curl, create 2 fake leads (same-person-ish) on tenant
   `a0000000-…-0001`; add a note + a logged activity to each (so children exist).
2. Call `POST /api/v1/leads/merge` with them. Verify (psql): 1 live lead; absorbed
   `deleted_at`+`merged_into` set; notes/activities/submissions all re-pointed to canonical;
   a synthesized `lead_submissions` row holds the absorbed's values; `lead_merges` row
   written with counts + patch; `lead.merged` event fired.
3. Call undo → verify the absorbed lead is restored and children re-pointed back.
4. Delete all synthetic test rows.

**B3 backfill:**
1. **Dry-run on Admizz** (`febeb37c-…`) → review the report (expect ~24 groups incl. sadin).
   Opus + Sadin review BEFORE any apply.
2. Apply on a SINGLE synthetic group in Zunkiree Labs first; verify; then (on Sadin's go)
   apply on Admizz. Confirm every absorbed lead's values survive as a `lead_submissions` row.
3. After zero live dup groups remain, create the `034` unique index on shared.

CI gates each commit: `npm run build` clean + `npx eslint --max-warnings 50` (0 errors).

## Sonnet handoff prompt

> Implement **Phase B** of the lead-dedup design (`docs/LEAD-DEDUP-PHASE-B-BRIEF.md`):
> the merge engine, merge UI + duplicate suggestions, and the backfill. Schema from
> migration `033` already exists (`lead_merges`, `lead_duplicate_suggestions`,
> `leads.merged_into`). Build in this order as separate commits: **B1** `src/lib/leads/merge.ts`
> (`mergeLeads` + `undo`, re-pointing ALL lead_id FKs incl. the `lead_insights` UNIQUE case
> and `audit_logs`/`events.entity_id`, synthesizing a preserved `lead_submissions` row,
> recording `lead_merges.repointed_counts`+`field_patch` for reversibility) + the admin
> `POST /api/v1/leads/merge` and `.../undo` routes; **B2** the merge dialog + "possible
> duplicates" card + wiring the A3 routes to persist phone `lead_duplicate_suggestions`;
> **B3** `src/lib/leads/backfill.ts` + `scripts/dedup-backfill.ts` (dry-run default,
> `--apply`/`--tenant`/`--undo`). Add migration `034` for `lead_merges.undone_at` and the
> deferred `uq_leads_tenant_norm_email` unique index (DDL only — do NOT apply the index to
> shared). **Reuse `applyCanonicalUpdate`/`recordSubmission` from `dedup.ts`,
> `emitEvent`/`createAuditLog`, `scopedClient`, `upsertThreadNotification`.** **STOP after
> B1 and its synthetic local test (Zunkiree Labs tenant only) — do NOT run the backfill
> apply on any real data; deliver the dry-run capability and wait for review.** Keep commits
> on a feature branch `feat/lead-dedup-phase-b` (not directly on stage). Run both CI gates.
> Apply migrations to a LOCAL/throwaway DB only. Report what you changed + the synthetic
> merge/undo test results; wait for review.

# OUTREACH-BULK-ENROLL-BRIEF — enroll many leads into a sequence at once (Phase 2)

Status: **Phase 2 (2a + 2b + 2c) built** on branch `feat/outreach-scale` (Phase 1 = reply-stop, mig 257; 2a = mig 258; 2b = mig 259; 2c = no migration).

> **2a build notes (what changed from the plan):**
> - **"All matching" from the leads list = the ids the table already collects** (`selectAllMatching` pages the real `/api/v1/leads` with the table's own params), sent as `selected` mode (<= 10,000). Reason: the table's scope params (list tab, funnel, stage, status, search, include_converted, the master view's staging/archive exclusion) are NOT part of the FilterTree, so a tree alone would not reproduce what the rep sees. Server re-checks visibility + contactability on those ids.
> - **`filter` mode (FilterTree) is implemented in the API** and used by the Sequences-tab / post-create entry points, which need the AdvancedFilterBar plumbing (fields, hierarchical groups, option overrides) — **deferred to 2b/2c**. 2a ships the leads-list entry only.
> - Materialization (audience resolution + the saved items) happens in the **Start request**, not the worker: own/branch-scope visibility needs a real user-authenticated client (`leads_visible_to_user()` fails closed for service-role), same constraint `email-blasts/[id]/send` documents.
> - `classifyLeads` was extracted from `resolveAudienceCore` unchanged (shared by SMS + email blasts); `AudienceBreakdown.excludedRows` added (additive) so the skipped CSV can name every skipped lead.
Part of the Outreach scale plan — see memory note `project_outreach_scale_plan`.

## 1. Problem

A lead enters a sequence only through `POST /api/v1/outreach/enrollments`, which takes ONE `lead_id` and ONE
`sequence_id`; the only UI is the "Enroll in sequence…" row on a single lead's Emails tab. Putting 100 (or 5,000)
leads in a sequence means 100 (or 5,000) page visits. Draft steps are one-at-a-time too, but enrollment is where
it starts — a lead has no draft until it is enrolled.

## 2. Goal

From the leads list (or a sequence), pick many leads — hand-picked rows OR everything a filter matches — see
exactly what will happen, confirm, and let EdgeX enroll them in the background, with progress, a result summary,
and a cancel. Safe to restart, safe to repeat, never enrolls anyone twice.

## 3. Who is in the audience (the "filter" part)

Two source modes, one dialog:

| Mode | Where it comes from | What is sent to the server |
|---|---|---|
| **Selected rows** | rows ticked on the leads list | `lead_ids` (<= the page selection, chunked <=100 per request like the existing bulk actions) |
| **All matching** | "Select all N matching" on the leads list, or an audience picked in the Sequences-tab / post-create flow | the **FilterTree** (same AST the leads list and Email Campaigns use, `src/lib/filters/types.ts`) — NOT 10,000 ids |

Rules:
- A filter is resolved **server-side** through the caller's own visibility (`visibleLeadsBase`), exactly like
  `resolveAudience` (`src/lib/email/outbound/audience.ts`). A rep can never enroll a lead they cannot see; a
  counselor is limited to own leads automatically.
- The leads filter registry (`src/lib/filters/registry/leads.ts`) has no `id` field, so **selected rows cannot be
  expressed as a filter tree**. Add a small `resolveAudienceForLeadIds(auth, ids, clients)` beside
  `resolveAudience` that loads those ids through `visibleLeadsBase(...).in("id", chunk)` and classifies them with
  the SAME email adapter (no second copy of the contactability rules). Do not touch the filter registry for this.
- Contactability (reuse, don't re-implement): no email, malformed email, suppressed (unsubscribed / bounced),
  duplicate email within the audience. Soft-deleted leads (`deleted_at`) never qualify.
- "Already in a sequence" = the lead has an `active` or `paused` enrollment (the partial unique index
  `uq_enrollment_active_lead`, mig 176). Looked up in chunks of ~200 ids (URL-length safe).

## 4. UX

Three entry points → ONE `BulkEnrollDialog`:
1. **Leads list** selection bar: "Enroll in sequence" (selected rows, or "all N matching" with the active filters).
2. **Sequences tab**: "Enroll leads" button on a sequence (audience via the filter bar).
3. **Right after "Create sequence"**: "Who should get it?" with **Skip for now**.

Dialog steps:
1. Pick the sequence (preset when opened from a sequence). Auto-send sequences are labelled — they send with no review.
2. **Preview** (read-only, writes nothing): will enroll N · skipped by reason (no email / bad email / unsubscribed /
   duplicate) · already in a sequence M · finish estimate from the daily cap · sandbox warning when on.
3. For the M already in a sequence choose: **skip** (2a) · **switch** · **queue next** (2b).
4. **Start** — separate click. From 100 leads up, type-to-confirm (same pattern as Email Campaigns' SendConfirmDialog).
5. **Progress** ("3,200 of 4,812") with **Cancel**; closing the dialog does not stop the run.
6. **Result**: enrolled / skipped (by reason) / failed, plus a CSV of every skipped lead with its reason.

## 5. Data (migration 258+, additive, files only — the pipeline applies them)

- `sequence_bulk_enrollments` (the run): `id, tenant_id, sequence_id, created_by, source_mode ('selected'|'filter'),
  source_snapshot jsonb (the filter tree or id count, for the audit trail), conflict_policy ('skip'|'switch'|'queue'),
  status ('queued'|'running'|'completed'|'cancelled'|'failed'), counts (total, enrolled, skipped, failed),
  cancel_requested bool, created_at/started_at/finished_at, error`.
- `sequence_bulk_enrollment_items` (one row per lead, **materialized at Start**): `run_id, tenant_id, lead_id,
  outcome ('pending'|'enrolled'|'skipped'|'failed'), reason, processed_at`, `UNIQUE (run_id, lead_id)`.
  Materializing at Start means the preview and the run can never drift, and resume/progress/CSV all read this table.
- `sequence_enrollment_queue` (2b, "queue next"): `lead_id, sequence_id, queued_by, run_id, status`; promoted when the
  lead's current enrollment completes or is unenrolled. Separate table on purpose — do not widen the
  `sequence_enrollments.status` CHECK that many readers depend on.
- Every table: `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE`, RLS via `get_user_tenant_ids()` /
  `is_tenant_admin()`, ledger self-record, idempotent statements, rollback line, before/after counts (0 rows touched).

## 6. API (all: `authenticateRequest` → `getFeatureAccess(OUTREACH)` → `scopedClient`)

- `POST /api/v1/outreach/bulk-enroll/preview` `{ sequence_id, source }` → counts only, no writes.
- `POST /api/v1/outreach/bulk-enroll` `{ sequence_id, source, conflict_policy }` → creates the run + items, kicks the worker, returns `run_id`.
- `GET  /api/v1/outreach/bulk-enroll/[id]` → status + counts (progress).
- `POST /api/v1/outreach/bulk-enroll/[id]/cancel`.
- `GET  /api/v1/outreach/bulk-enroll/[id]/skipped` → CSV.
- Hard limit per run: **10,000 leads** (constant, error above it). Typed confirmation from **100 leads**.

## 7. Worker

- **In-app timer, no Inngest** — same shape as `blast-runner.ts` / `sequence-schedule-runner.ts`: a function started
  from `src/instrumentation.ts` (~30 s) plus an immediate `after()` call from the Start route.
- Each pass takes a run, processes `pending` items in chunks (~200), and for each lead calls the existing
  `enrollLead` (`outreach/lib/engine.ts`) — the ONLY place an enrollment is created, so the one-running-sequence rule
  and the unique index still decide races. `EnrollmentConflictError` → outcome `skipped` / reason `already_in_sequence`.
- Checks `cancel_requested` between chunks. Per-lead failures are recorded, never abort the run.
- Restart-safe: item outcomes are persisted, a restart just continues with the remaining `pending` items; a module-level
  `running` guard stops overlapping passes in one process and the unique index covers a second process.

## 8. Safety rules (apply to every phase)

Works for thousands · safe to retry · respects daily cap, unsubscribes/bounces, no-email, role/branch scope, sandbox ·
preview + confirm before anything happens · result reported afterwards · cancellable.
Replies already pause enrollments (Phase 1), so a bulk enroll into an auto-send sequence stops for anyone who answers.

## 9. Build order (one commit each, on `feat/outreach-scale`)

- **2a** core: ids helper, run/item tables, preview, start, worker, progress, result + CSV, cancel, **leads-list entry point**, conflict policy = skip only. **BUILT.**
- **2b** switch + queue next, a **Pause all / Resume all** for a sequence, and the **Sequences-tab / post-create entry points** (filter mode + the filter bar). **BUILT** (mig 259).
- **2c** `daily_send_cap` field in the email settings UI (admin-only, bounded 50..5,000, reputation warning); the preview's finish-time estimate already reads it. **BUILT.**

## 10. Tests

Unit: audience-for-ids helper (visibility, contactability, duplicates) · policy decisions · chunking · restart/resume ·
cancel mid-run · idempotent double Start · 10,000 limit · cap-estimate math · route gates (403 non-feature, counselor
scope). Run only explicit non-DB test files (local Supabase is up — never the whole suite).
Scale test (needs the user's go, writes data on dev): enroll ~1,000 existing dev leads into a throwaway auto-send
sequence on staging (staging uses a stub transport — nothing leaves it); check progress, cancel, restart, no duplicates.

## 11. Out of scope here

Send window / timezone / spread (Phase 3 — BUILT, mig 260; see FEATURE-CATALOG) · moving auto-send off Inngest (Phase 4) · live-edit of a running
sequence, test-send, reporting (Phase 5 — BUILT, mig 263; see FEATURE-CATALOG) · bulk draft actions (Phase 6 — BUILT, no migration; see FEATURE-CATALOG).

## 12. Open decisions

1. 10,000 per run and typed confirmation from 100 leads — confirmed? 2. Default conflict policy in the dialog: skip.
3. Until Phase 3 exists, step 1 of a bulk enroll is due immediately and is released by the daily cap.

# IT-Agency Delivery — Tier 4: Unified Approvals Inbox (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** **NONE** (pure read-aggregation + reuse of existing endpoints; one small guard-fix to existing routes) · **Stop at review** — build uncommitted, Opus verifies + commits.

**Reviewed + scoped by Opus with Sadin.** Scope = one queue that surfaces everything awaiting an admin's decision across the three existing delivery approval flows, with **inline** action. No new tables. No new mutation logic — the inbox POSTs to endpoints that already exist.

---

## 0. Why this exists

Three approval flows already ship — **time-entry approvals** (dedicated `/time-tracking/approvals` queue), **milestone acceptance**, and **change-request approval** — but milestones and CRs can only be actioned buried inside each project's cockpit. There is **no single place** for a PM/owner to see and clear everything waiting on them. This builds that: `/approvals` aggregates all three, tenant-wide, with one-click approve/reject.

---

## 1. Decisions locked (do NOT re-litigate)

| # | Decision | Ruling |
|---|---|---|
| 1 | Which milestone status = "awaiting approval" in the inbox | **Only `submitted`.** (Cockpit stays permissive; the inbox shows just the semantically-correct "submitted for acceptance" set.) |
| 2 | How to act on an item | **Inline approve/reject**, wired to the existing endpoints. No navigation required to clear a decision. |
| 3 | Route + nav | **New top-level `/approvals`** page; **repoint** the existing sidebar "Approvals" item to it; **redirect** old `/time-tracking/approvals` → `/approvals`. |
| 4 | "Assigned to me" vs "all pending" | **All pending in my tenant.** None of the three entities has an approver-identity column; any admin/owner can approve any pending item (confirmed by recon). Do NOT invent approver columns. |
| 5 | Access | Owner/admin only, tenant-wide. Page + route gated on **`FEATURES.PROJECT_BOARD`** + `requireAdmin`. |

---

## 2. Ground truth (exact, from recon — build against these)

All three tables have `tenant_id` + `project_id` (both NOT NULL), tenant-wide RLS, and use `scopedClient(auth)`.

**A. Time entries** — `time_entries.approval_status` ∈ `('pending','approved','rejected')`. Awaiting = `pending`.
- Approve: `POST /api/v1/time-entries/[id]/approve` (no body). Reject: `POST /api/v1/time-entries/[id]/reject` — body `reason` **REQUIRED** (maxLength 500). Gated `FEATURES.TIME_TRACKING` + `requireAdmin`. Both already have a `.eq("approval_status","pending")` race guard.
- Fields for a row: `id`, `user_id` (who logged), `project_id`, `entry_date`, `minutes`, `description`.

**B. Milestones** — `project_milestones.status` ∈ `('pending','in_progress','submitted','accepted','rejected')`. Inbox awaiting = **`submitted`** (decision 1).
- Accept: `POST /api/v1/milestones/[id]/accept` (no body). Reject: `POST /api/v1/milestones/[id]/reject` — body `reason` **optional** (maxLength 2000). Gated `FEATURES.PROJECT_BOARD` + `requireAdmin`.
- ⚠️ These two routes currently have **no status-precondition guard** — see §5 (fold-in fix).
- Fields for a row: `id`, `project_id`, `title`, `amount`, `due_date`, `updated_at` (use as the "submitted at" proxy — there is no `submitted_by`/`submitted_at` column; note this in the row).

**C. Change requests** — table is **`project_change_requests`** (route folder `/change-requests`). `status` ∈ `('proposed','approved','rejected')`. Awaiting = **`proposed`**.
- Approve: `POST /api/v1/change-requests/[id]/approve` (no body; side-effect bumps `projects.current_estimate_minutes`). Reject: `POST /api/v1/change-requests/[id]/reject` — body `reason` optional. Gated `FEATURES.PROJECT_BOARD` + `requireAdmin`. Both already have a `.eq("status","proposed")` race guard.
- Fields for a row: `id`, `project_id`, `title`, `classification` (`in_scope`/`new_scope`), `estimate_delta_minutes`, `budget_delta_amount`, `created_at`.

> Column-name divergence to handle in normalization: decision cols differ (`approved_*` / `accepted_*` / `decided_*`); CRs have no `rejection_reason` column (reason only goes to the event payload). The inbox doesn't read decision columns (it only lists *pending* items) so this mostly matters for the reject-body contract per type.

---

## 3. Aggregation API — `GET /api/v1/approvals`

New route `src/app/(main)/api/v1/approvals/route.ts`. Standard preamble: `authenticateRequest` → `getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)` → `requireAdmin` → `scopedClient(auth)`.

`Promise.all` of three scoped queries (mirror the parallel-fetch pattern in `time-entries/[id]/approve/route.ts:59-70`), then normalize each into a shared row shape and return grouped:

```ts
interface ApprovalRow {
  kind: "time_entry" | "milestone" | "change_request";
  id: string;
  projectId: string;
  projectName: string;            // from embedded projects(name)
  title: string;                  // TE: description||"Time entry"; MS: title; CR: title
  submittedAt: string;            // TE: entry_date; MS: updated_at; CR: created_at
  submittedByName?: string | null;// TE: resolve user_id→name; MS/CR: null (no column)
  // kind-specific detail for the row's right side:
  detail: Record<string, unknown>;// TE:{minutes}; MS:{amount,dueDate}; CR:{classification,estimateDeltaMinutes,budgetDeltaAmount}
}
return apiSuccess({
  timeEntries: ApprovalRow[],     // approval_status='pending'
  milestones:  ApprovalRow[],     // status='submitted'
  changeRequests: ApprovalRow[],  // status='proposed'
  counts: { timeEntries: n, milestones: n, changeRequests: n, total: n },
});
```

Query notes:
- Embed the project name: `.select("id, project_id, ..., projects(name)")` (the codebase embeds `projects(name)` elsewhere, e.g. accounts invoices route).
- Time entries: to resolve `user_id → name`, reuse the same approach the existing approvals queue uses (`GET /api/v1/team` mapping) — either resolve server-side via a `tenant_users`+auth lookup, or return `user_id` and let the page map it from a `/api/v1/team` fetch it already needs. Prefer server-side resolution so the page stays simple; if that's heavy, returning `user_id` + a client `/team` map (as the existing queue does) is acceptable — match whichever the existing queue does.
- Sort each list by `submittedAt` ascending (oldest waiting first).
- Every query is `scopedClient`, so tenant isolation is automatic; do not add manual tenant filters.

---

## 4. UI — `/approvals` unified inbox

### 4a. Route shell
`src/app/(main)/(dashboard)/approvals/page.tsx` — **mirror the existing** `src/app/(main)/(dashboard)/time-tracking/approvals/page.tsx` shell exactly (same auth + `getFeatureAccess(..., FEATURES.PROJECT_BOARD)` gating pattern; if the existing shell uses a different gate, keep the same *structure* but gate on `PROJECT_BOARD`). Delegate to the UI component.

### 4b. Component
New folder `src/industries/it-agency/features/approvals/` (industry-scoped; no new registry/manifest feature entry needed — it's gated by the existing `PROJECT_BOARD` feature via the route shell). Component `pages/approvals-inbox.tsx`:
- Client-side admin guard (`role === "owner" || "admin"`) mirroring `approvals-queue.tsx:203`.
- Fetches `GET /api/v1/approvals` (+ `/api/v1/team` if needed for name mapping).
- Header: "Approvals" + total count. Empty state when `counts.total === 0` ("You're all caught up").
- **Three sections**, each with its count and hidden when empty:
  1. **Change requests** (highest-stakes — scope/budget) — individual rows.
  2. **Milestones** (submitted for acceptance) — individual rows.
  3. **Time entries** — see 4d (grouped).

### 4c. Row + inline actions (milestones & change requests)
Each row: project name, title, kind-specific detail chips (CR: classification badge + `+Xh` / `+currency Y`; MS: amount via `formatMoney` + due date), waiting-age (from `submittedAt`).
- **Approve** button → POST the kind's approve endpoint; on success remove the row + decrement count; toast.
- **Reject** button → opens a small reason input (required for time entries; optional for MS/CR), POST reject endpoint, same optimistic removal.
- Disable buttons while the request is in flight; re-enable + toast on error (e.g. a 409 if someone else already actioned it → remove the row and toast "already handled").
- Use `formatMoney(amount, currency)` from `src/lib/travel/currency.ts` for money (NPR-aware). Milestones have no currency on the row — use the project currency if you embed it, else omit the symbol / use a neutral format; do NOT hardcode `$`.

### 4d. Time-entries section (volume-aware)
Time entries are high-volume and already have a full bulk queue. To honor "inline" without rebuilding that whole UI:
- Group pending time entries **by member** (mirror `approvals-queue.tsx` grouping): one row per member — "{name} · {N} entries · {total hours}" with an inline **"Approve all"** (fires the per-entry approve endpoint for that member's entries via `Promise.allSettled`, exactly like the existing queue's bulk approve).
- Provide a **"Open full queue →"** link to `/time-tracking/approvals` (now `/approvals`… see §6 — keep a granular review surface) for granular per-entry review + reject-with-reason. Rejecting individual time entries with reasons stays in the detailed queue; the inbox's job is fast bulk-approve + visibility. State this in a one-line helper under the section.

> Rationale for the split: milestones/CRs are low-volume, high-judgment → individual inline. Time entries are high-volume, low-judgment → grouped bulk-approve + deep-link for the nuanced cases. This is still "inline action," just volume-appropriate.

---

## 5. Fold-in fix — milestone accept/reject race guard (small, same PR)

The recon found `milestones/[id]/accept` and `.../reject` **lack the status-precondition guard** that time-entries and CRs have, so the inbox's one-click approve could double-fire. Add the guard **without breaking the cockpit** (which legitimately accepts `pending`/`in_progress`/`submitted`):
- On both routes, add a precheck: load the milestone; if `status` is already `accepted` or `rejected`, return `apiConflict("Milestone already <status>")`.
- On the `update`, add `.in("status", ["pending","in_progress","submitted"])` so a concurrent double-action updates 0 rows (TOCTOU guard). Do **not** restrict to `submitted` only — that would break accepting earlier-stage milestones from the cockpit.

---

## 6. Sidebar repoint + old-route redirect

- **`src/industries/it-agency/manifest.ts`** — the existing sidebar "Approvals" entry (gated `FEATURES.TIME_TRACKING`, `href: "/time-tracking/approvals"`, `icon: "Stamp"`, `minRoles: ["owner","admin"]`): change `href` → `"/approvals"`. Consider changing `featureId` to `FEATURES.PROJECT_BOARD` for consistency (both are enabled for it_agency, so either works; PROJECT_BOARD matches the new page's gate). Keep `minRoles`.
- **Old route redirect** — turn `src/app/(main)/(dashboard)/time-tracking/approvals/page.tsx` into a redirect to `/approvals` (mirror the Phase-1.5 route-repoint pattern: `redirect("/approvals")`). **Preserve the detailed per-entry time-entry review UI** by moving it, not deleting it: relocate the `ApprovalsQueuePage` component so the inbox's "Open full queue →" link (§4d) still reaches a granular time-entry review surface. Simplest: keep the component where it is and have the inbox link to a sub-route (e.g. `/approvals/time-entries`) that renders it, and redirect the *old* `/time-tracking/approvals` → `/approvals/time-entries`. Pick the cleanest of these and note what you did; the invariant is **no loss of the existing granular bulk review/reject UI**.

> If the redirect/relocation gets fiddly, the acceptable fallback is: keep `/time-tracking/approvals` working as-is (the granular queue), point the inbox deep-link at it, and only repoint the *sidebar* to `/approvals`. Flag which path you took.

---

## 7. Verification (Sonnet does locally; Opus re-runs)

1. `npm run build` clean; `npx eslint --max-warnings 0` clean on every new/changed file. **No migration** — confirm none was added.
2. **Local dogfood as it_agency admin** (`admin@edgex.local` / Test Agency):
   - Seed one of each: a pending time entry, a milestone set to `submitted`, a change request in `proposed`. Confirm all three appear in `/approvals` under the right sections with correct counts + project names.
   - Inline **approve** a CR → row vanishes, count drops, and (verify) `projects.current_estimate_minutes` bumped + `change_request_approved` event recorded.
   - Inline **reject** a milestone with a reason → row vanishes, `status='rejected'`, `rejection_reason` set, `milestone_rejected` event recorded.
   - Time-entries section: "Approve all" for a member approves their pending entries (verify `approval_status='approved'` + `rate_snapshot` frozen); "Open full queue" reaches the granular review UI.
   - Empty state shows when nothing pending.
   - **Milestone gate:** a `pending`/`in_progress` milestone does NOT appear in the inbox; only `submitted` does.
3. **Race guard (§5):** accept the same submitted milestone twice quickly (or accept one already accepted) → second call returns 409, no double event.
4. **Negative checks:**
   - Non-admin it_agency user (real viewer login): `/approvals` route → gated (redirect/404 per the shell pattern), `GET /api/v1/approvals` → 403, sidebar item hidden (minRoles).
   - Non-it_agency tenant (temporarily flip a test tenant to `education_consultancy`, then revert): `/approvals` → 404, `GET /api/v1/approvals` → 403.
   - Tenant isolation: the aggregation returns only the caller's tenant's pending items (scopedClient) — verify nothing cross-tenant leaks.
5. Sidebar "Approvals" now lands on `/approvals`; old `/time-tracking/approvals` redirects per §6.

---

## 8. Definition of done / hand-back

- `GET /api/v1/approvals` aggregation (3 scoped queries → normalized, counts), admin-gated.
- `/approvals` unified inbox: CR + milestone individual inline approve/reject, time-entries grouped bulk-approve + deep-link, empty state, `formatMoney`.
- §5 milestone race-guard fold-in.
- Sidebar repointed + old route redirect, granular time-entry review UI preserved.
- **No migration.** Build + lint clean; §7 dogfood + negative + race checks pass.
- **STOP. Do not commit, do not open/modify a PR, do not touch stage/prod.** Produce a short report: files changed (API / UI / manifest / redirect), the §6 path you chose, dogfood + negative results, any deviations. Opus reviews the diff, re-runs gates, commits on this branch.

---

## 9. Deferred (note only — do NOT build)
Sidebar/Home **live count badge** (touches the universal `attention-summary.tsx` → needs `industryId` gating; separate change), "assigned to me" routing (needs new approver columns on all three), issue-resolution + leave into the same inbox, per-section filters/sort controls, keyboard-driven triage, notifications/reminders on aging approvals.

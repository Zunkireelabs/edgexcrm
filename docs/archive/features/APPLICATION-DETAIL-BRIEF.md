# Application Detail / Inner Page — Build Brief (education_consultancy)

> **Status:** planned, branch + brief done. Awaiting Sonnet build. Stop-at-review.
> **Branch:** `feature/application-detail-page` (off `origin/stage` @ `9fa0871`, which includes the base Application Tracking feature). PR target: **`stage`**.
> **Scope:** v1 **lean core** — a per-application detail page at `/applications/[id]`. Builds on the shipped Application Tracking feature.
> **No migration, no new API** — pure UI/page addition. Stage-advance + edit reuse the existing `PATCH /api/v1/applications/[id]`; the activity timeline renders the `audit_logs` we already write, fetched server-side in the route shell.
> **Owner:** Opus plans/reviews · Sonnet implements (stop-at-review) · Sadin = visual smoke.

---

## 1. Why

The Application Tracking feature (shipped to stage) gives a record + an edit sheet + a board, but no
per-application **inner page**. Reference: AgentCIS's application workspace (student rail + vertical stage
stepper + activity timeline + sub-tabs + financials). Research (AgentCIS/Meritto/LeadSquared/Salesforce
EDA) says the **must-have core** is: context header + stage stepper + activity timeline + (later) documents
+ tasks. Financials/commission + per-country pipelines + check-in/forms sub-tabs are growth-tier — **deferred**.

**v1 = lean core:** Header · vertical **Stage Stepper** · **Activity Timeline** (from `audit_logs`) ·
editable **Details** (reuse the edit-sheet fields) · **Student rail** · rewire navigation to open the page.

## 2. Locked decisions (from Sadin)

1. v1 = **lean core** (no document checklist / tasks this round — those are v2).
2. Timeline = **reuse the `audit_logs` we already write** (no notes/comments composer in v1).

## 3. Layout (3-column, mirrors `lead-detail-v2.tsx`)

```
← Back to Applications
┌── STUDENT RAIL ──┬── CENTER ───────────────────────────────┬── DETAILS (right) ──┐
│ ContactCard      │ HEADER: University · Program · Intake ·  │ reuse edit-sheet    │
│ (reuse)          │ Country · [stage badge] · owner · ◐ %    │ field set:          │
│ KeyInfo (InfoRow)│ [Edit] [⋯]                               │ offer_type,         │
│ student context  │                                          │ deadline,           │
│                  │ STAGE STEPPER (vertical, NEW component)   │ financials (fee/    │
│                  │  ✓ past  ● current  ○ future  ✦won ✕lost │ tuition/deposit),   │
│                  │  click a stage → advance (gated)         │ offer_letter, notes │
│                  │                                          │ (editable, gated)   │
│                  │ ACTIVITY TIMELINE (audit_logs)           │                     │
│                  │  ● Stage → X · 2h · user                 │                     │
└──────────────────┴──────────────────────────────────────────┴─────────────────────┘
```

## 4. Reuse map (from codebase scan — do not reinvent)

| Build target | Mirror / reuse |
|---|---|
| Route shell `applications/[id]/page.tsx` | `src/app/(main)/(dashboard)/deals/[id]/page.tsx` (gate pattern) + the data-fetch/scoping of `applications/page.tsx` |
| Header + inline-edit + delete dialog | `src/industries/it-agency/features/deals/pages/deal-detail.tsx` |
| 3-column grid | `src/components/dashboard/lead/lead-detail-v2.tsx:449` |
| Editable Details field set | `.../application-tracking/components/application-detail-sheet.tsx` (lift its fields — do NOT build a 3rd edit surface) |
| Student rail | `src/components/dashboard/lead/contact-card.tsx` (takes a full `Lead`) + `key-info-section.tsx` `InfoRow` pattern (don't reuse the whole lead-branched component) |
| Activity timeline render | `src/components/dashboard/lead/activities/activities-panel.tsx` → `SystemActivityItem` + `getSystemActivityDescription` |
| Timeline read helper | clone `getLeadActivity` in `src/lib/supabase/queries.ts` → `getApplicationActivity(applicationId, tenantId)` reading `audit_logs` WHERE `entity_type='application'` |
| Stage badge | `.../application-tracking/components/status-badge.tsx` |
| Stage-change mutation + terminal toast | `.../application-tracking/components/applications-board.tsx` (drag → `PATCH {stage_id}` → read `data.status`, terminal toast) |
| Stage stepper | **NEW** — none exists; build from `ApplicationStage[]` ordered by `position` (+ `color`, `terminal_type`) |

Data shapes: `Application` + `ApplicationStage` in `src/types/database.ts`. Existing `GET /api/v1/applications/[id]`
already returns the application with `leads(id,first_name,last_name,email)` + `application_stages(...)` joins.

## 5. Build plan (one PR to `stage`)

- **D1 — Route shell** `src/app/(main)/(dashboard)/applications/[id]/page.tsx`: `getCurrentUserTenant` →
  `getFeatureAccess(FEATURES.APPLICATION_TRACKING) → notFound()`. Fetch (service client, tenant-scoped):
  (a) the application + joins; (b) `application_stages` ordered by `position`; (c) the **full lead**
  (`/leads` row for the rail — phone/city/intake/source, not just the GET join's id/name/email); (d) the
  **audit_logs timeline** via `getApplicationActivity`. **Apply the same parent-lead scope guard the
  `[id]` API uses** (`shouldRestrictToSelf` + `getLeadMembership` + `requireLeadBranchAccess`) → `notFound()`
  if the actor can't access the parent lead. Pass `canManageApplications` + `role` to the client page.
- **D2 — Detail page** `.../features/application-tracking/pages/application-detail.tsx` (client): the
  3-column layout; header with stage badge + owner + progress %; Details card reusing the edit-sheet fields
  (edit gated by `canManageApplications`, saves via `PATCH /api/v1/applications/[id]`).
- **D3 — Stage stepper** `.../components/stage-stepper.tsx`: vertical list of stages by `position` — past
  (check + stage color), current (filled/ring), future (muted), terminal nodes styled by `terminal_type`.
  Clicking a stage advances (gated `canManageApplications`) → `PATCH {stage_id}` → optimistic update +
  terminal toast (mirror the board). Allow jump to any stage (consistent with the board).
- **D4 — Activity timeline** `.../components/application-activity-timeline.tsx`: render the `audit_logs`
  rows; reuse `SystemActivityItem` look; extend `getSystemActivityDescription` (or a local mapper) for
  `application.created` / `application.updated` / `application.stage_changed` descriptions.
- **D5 — Server read helper** `getApplicationActivity(applicationId, tenantId)` in
  `src/lib/supabase/queries.ts` (clone of `getLeadActivity`, `entity_type='application'`, limit ~50).
- **D6 — Progress %** computed from current stage `position` vs the max non-terminal `position` (simple).
- **D7 — Rewire navigation**: clicking an application (board `application-card.tsx`, `applications-table.tsx`
  row, and the per-lead `applications-panel.tsx` row) → navigate to `/applications/[id]`. Keep the **student
  name** linking to `/leads/[id]`; the **application** opens the new page. The existing edit sheet stays
  usable for quick edits from the board (or the board card opens the page — Sonnet's call, keep one edit path).
- **D8 — Docs**: `FEATURE-CATALOG.md` note (detail page added), SESSION-LOG entry, STATUS-BOARD update.

## 6. Gating & scope
- Page gate: `FEATURES.APPLICATION_TRACKING` → `notFound()` for non-education.
- Parent-lead scope: a counselor must not open an application on a lead they can't access — replicate the
  `[id]` API's `shouldRestrictToSelf` + branch-membership guard in the route shell → `notFound()`.
- Writes (stage advance, details edit): gated by `canManageApplications` (already the API's gate; mirror in UI).
- **No new migration, no new API route.** Timeline is fetched server-side in the route shell (RLS-safe).

## 7. Out of scope (v1 — deferred)
Document checklist (table + storage + statuses), per-application tasks/reminders, notes/comments composer,
email-into-timeline, financials/commission, per-country stage pipelines, check-in/forms/education sub-tabs.

## 8. Verification (Sonnet runs; Opus re-runs the gates)
- `npm run build` clean + `npx eslint --max-warnings 50` clean — paste real output.
- **No DB changes** — nothing to apply to the shared Supabase DB this round.
- Gate matrix: education tenant → open an application from board/table/lead-tab → `/applications/[id]`
  renders (header + stepper + timeline + details + rail); advance a stage → stepper + header % update +
  timeline gains an entry + terminal toast; edit details → saves + timeline logs it. Counselor → can't open
  an application on a lead they can't access (`notFound`). Non-education → `/applications/[id]` 404s.
- Pixel/visual smoke = Sadin (the demo prospect `114dc3a3-…`'s application is a ready test subject on dev).

## 9. Execution model
Opus writes this brief; Sonnet builds **stop-at-review** (commit to `feature/application-detail-page` only —
no push, no PR merge; no DB writes this round). Opus reviews post-hoc + re-runs gates. Prod only on Sadin GO.

---

## 11. Round 2 — Cleanup (post-Opus-review of `017a755`, 2026-06-20)

Opus reviewed. **Gates green** (build exit 0; eslint 0 errors; not pushed). Route-shell scope guard is
faithful to `requireLeadBranchAccess`; page/stepper/timeline/nav-rewire all correct; the board correctly
dropped the sheet and now navigates to the page. Three minor cleanups before stage:

### Fix 1 — Activity timeline must reflect edits/stage-changes in real time (the important one)
Today `handleStageChange` inserts an **optimistic fake entry attributed to "system"** (no user), and a
details **edit adds nothing** to the timeline until reload — so the page's headline feature looks
half-broken. Fix:
- Render the activity timeline **directly from the `activityTimeline` prop** — remove the `timeline`
  `useState` and the optimistic fake-entry insertion in `handleStageChange`.
- Import `useRouter` and call **`router.refresh()`** after a successful PATCH in **both** the stage-change
  handler (`handleStageChange`, after the optimistic `setApplication`) and `saveEdit` (after `setApplication`).
  `router.refresh()` re-runs the route shell → re-fetches `getApplicationActivity` + the application → passes
  fresh props → the (now prop-driven) timeline shows the **real** `audit_logs` entries with correct
  `user_id` attribution. Keep the optimistic `setApplication` for stepper/header snappiness.

### Fix 2 — Delete orphaned dead code
`src/industries/education-consultancy/features/application-tracking/components/application-detail-sheet.tsx`
is no longer imported anywhere (board navigates to the page; the page reimplements the fields inline).
`git rm` it. Confirm no remaining imports first.

### Fix 3 — Remove the unused `role` prop
The detail page receives `role` but never uses it. Drop it from `ApplicationDetailPageProps`, the
`page.tsx` route-shell call site, and anywhere else it's threaded.

### Round-2 gate (same stop-at-review)
`npm run build` + `npx eslint --max-warnings 50` clean (paste output). No DB writes. Commit to
`feature/application-detail-page` only — no push, no PR. Re-verify: advance a stage → timeline shows the real
entry (attributed to you) within a moment; edit a field → timeline shows the update; deleting the orphaned
sheet didn't break the board (board still opens the page).

---

## 10. Sonnet handoff prompt (copy-paste)

```
Implement the Application Detail / inner page for edgeX CRM (education_consultancy). Full spec:
docs/APPLICATION-DETAIL-BRIEF.md — read it completely, then read the precedents it cites:
src/industries/it-agency/features/deals/pages/deal-detail.tsx + deals/[id]/page.tsx (structure + route
shell), src/components/dashboard/lead/lead-detail-v2.tsx (3-col grid) + activities/activities-panel.tsx
(timeline render), src/lib/supabase/queries.ts getLeadActivity (timeline read), and the existing
application-tracking components (application-detail-sheet.tsx field set, applications-board.tsx stage
mutation, status-badge.tsx).

You are ALREADY on branch feature/application-detail-page (off origin/stage, which includes the base
Application Tracking feature). Do all work here.

Build D1→D8 from the brief. Key rules:
- v1 = LEAN CORE only: route shell + detail page (3-col) + vertical stage stepper (NEW component) +
  activity timeline from audit_logs + editable Details (REUSE the edit-sheet fields, do NOT build a third
  edit surface) + student rail (reuse ContactCard). NO document checklist, NO tasks, NO notes composer.
- NO new migration and NO new API route. Stage-advance + details-edit use the existing PATCH
  /api/v1/applications/[id]. The timeline is fetched SERVER-SIDE in the route shell via a new
  getApplicationActivity() helper (clone getLeadActivity, entity_type='application') — passed as a prop.
- Route shell gates on FEATURES.APPLICATION_TRACKING → notFound, AND replicates the [id] API's parent-lead
  scope guard (shouldRestrictToSelf + getLeadMembership + requireLeadBranchAccess) → notFound if the actor
  can't access the parent lead. UI writes gated by canManageApplications.
- Rewire the board card / applications table row / per-lead panel row to open /applications/[id]; keep the
  student name linking to /leads/[id].

STOP AT REVIEW: commit to feature/application-detail-page only — NO push, NO PR, NO promotion, NO DB writes.
Run `npm run build` and `npx eslint --max-warnings 50` and paste the real output. Then hand back for Opus review.
```

# IT-Agency Delivery — Tier 4: Milestone Lifecycle Transitions (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** **NONE** (the `status` CHECK already has all five values) · **Stop at review** — build uncommitted, Opus verifies + commits.

**Reviewed + scoped by Opus with Sadin.** This closes the loop opened by the approvals inbox: today nothing sets a milestone to `submitted`, so the inbox's milestone section is always empty. This adds the guided lifecycle (Start / Submit / Reopen) so milestones actually flow into the approvals queue.

---

## 0. The gap (why)

`project_milestones.status` allows `pending / in_progress / submitted / accepted / rejected`, but the app only ever produces `pending` (on create) → `accepted`/`rejected` (accept/reject buttons jump straight there). **`in_progress` and `submitted` are vestigial**, and `GET /api/v1/approvals` filters milestones on `status='submitted'` — so that section never populates. This makes the five statuses real.

There is also an **unvalidated back-door**: the generic `PATCH /api/v1/milestones/[id]` currently accepts `{status:"<anything>"}` with no transition validation and records no event. It's unwired to any UI. This brief makes the new `transition` route the single validated status path and **removes status-writing from that PATCH**.

---

## 1. Decisions locked (do NOT re-litigate)

| # | Decision | Ruling |
|---|---|---|
| 1 | Scope | **Full guided lifecycle** — Start (`pending→in_progress`), Submit (`→submitted`), Reopen (`rejected→in_progress`), plus pull-back (`submitted→in_progress`). Accept/Reject stay as the approval decision. |
| 2 | UI trigger | **Contextual action buttons** per milestone showing only legal next moves. No raw dropdown. |
| 3 | Who can transition | **Admin/owner only** (milestones have no owner/assignee column — member-submit isn't expressible without a migration; out of scope). Matches every milestone mutation today. |
| 4 | Mechanism | **New dedicated `POST /api/v1/milestones/[id]/transition`** owns the state machine + events. Accept/Reject routes unchanged. Generic PATCH loses status-writing. |

---

## 2. State machine (the transition route enforces this)

Lifecycle transitions handled by `/transition` (approval transitions to `accepted`/`rejected` stay in the accept/reject routes and are NOT valid targets here):

```
LEGAL_TRANSITIONS: Record<status, status[]> = {
  pending:     ["in_progress", "submitted"],   // Start / Submit (may skip in_progress)
  in_progress: ["submitted"],                   // Submit
  submitted:   ["in_progress"],                 // Pull back (before a decision)
  rejected:    ["in_progress"],                 // Reopen for rework
  accepted:    [],                              // terminal
}
```

- Any target not in the list for the current status → `apiConflict` with a helpful message. If `to` is `accepted`/`rejected`, the message should say "use the accept/reject action."
- **On any transition INTO `in_progress` from `rejected`** (reopen): also clear `rejection_reason = null` (it's being reworked).
- Do NOT touch `accepted_at`/`accepted_by` on lifecycle moves (those belong to accept/reject).
- `accepted` is terminal — no lifecycle move out (and it may be invoiced; leave invoicing untouched).

---

## 3. New route — `POST /api/v1/milestones/[id]/transition`

New file `src/app/(main)/api/v1/milestones/[id]/transition/route.ts`. Mirror the shape of `accept/route.ts` exactly (it's the closest sibling):

1. Preamble: `authenticateRequest` → `getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)` → `requireAdmin` → `scopedClient(auth)`.
2. Parse body `{ to: string }`; validate `to` is one of the five `MILESTONE_STATUSES` (reuse the same const/pattern as the generic PATCH, `milestones/[id]/route.ts:17`). Missing/invalid → `apiValidationError`.
3. Load the milestone scoped (`select id, project_id, title, status`); 404 if missing.
4. Compute `legal = LEGAL_TRANSITIONS[current] ?? []`. If `to` not in `legal` → `apiConflict`. (Special-case message when `to` ∈ {accepted, rejected}: "Use the accept/reject action to decide a milestone.")
5. Build the patch: `{ status: to }`, plus `rejection_reason: null` **iff** `current === "rejected" && to === "in_progress"`.
6. **TOCTOU-guarded update** (mirror accept route): `.update(patch).eq("id", id).eq("status", current).select().maybeSingle()`. If `!updated` → `apiConflict("Milestone already moved")` (a concurrent change won the race).
7. `recordProjectEvent(db, { projectId, eventType, actorId: auth.userId, summary, payload: { milestone_id: id, from: current, to }, subjectType: "milestone", subjectId: id })` where:
   - `to === "submitted"` → `eventType: "milestone_submitted"`, summary `Milestone submitted for acceptance: <title>`
   - `to === "in_progress"` → `eventType: "milestone_started"`, summary `Milestone moved to in progress: <title>` (payload `from` distinguishes start vs pull-back vs reopen)
8. `createAuditLog(action: "milestone.transitioned", entityType: "milestone", entityId: id, ...)`.
9. Return the updated row.

**Types:** add `"milestone_submitted"` and `"milestone_started"` to the `ProjectEventType` union in `src/types/database.ts:682-699` (next to the existing `milestone_accepted`/`milestone_rejected`).

---

## 4. Harden the generic PATCH (close the back-door)

`src/app/(main)/api/v1/milestones/[id]/route.ts`: **remove status-writing.** Delete the `status` handling (the `isIn(MILESTONE_STATUSES)` validation entry ~`:44` and the `if (body.status !== undefined) patch.status = ...` line ~`:62`). The PATCH becomes a field-editor for `title`/`description`/`due_date`/`amount`/`sort_order` only. Status changes now flow exclusively through `transition` / `accept` / `reject`. (This route is currently unwired to any UI, so removing status is safe — nothing depends on it.)

---

## 5. Hook + Panel wiring

### 5a. Hook — `src/industries/it-agency/features/project-board/hooks/use-project-milestones.ts`
Add one mutation, mirroring `acceptMilestone`:
```ts
transitionMilestone(milestoneId: string, to: string): Promise<boolean>
// POST /api/v1/milestones/${id}/transition  body { to }  → on success await load(); toast.error on failure
```
Export it alongside the existing `{ createMilestone, acceptMilestone, rejectMilestone, refetch }`.

### 5b. Panel — `src/industries/it-agency/features/project-board/components/cockpit/milestones-panel.tsx`
Add an `onTransition(milestoneId: string, to: string)` prop and render **contextual action buttons** per milestone (admin-only, alongside the existing status badge). Legal-action map per status:

| Status | Buttons shown (admin) |
|---|---|
| `pending` | **Start** (→in_progress) · **Submit** (→submitted) |
| `in_progress` | **Submit** (→submitted) |
| `submitted` | **Accept** · **Reject** (existing) · **Pull back** (→in_progress, subtle/secondary) |
| `rejected` | **Reopen** (→in_progress) — and show the `rejection_reason` if present |
| `accepted` | none (terminal; optionally a muted "Invoiced" hint if `invoiced_at` set) |

- Keep the existing Accept/Reject wiring (`onAccept`/`onReject`) exactly as-is for the `submitted` state.
- Start/Submit/Pull back/Reopen all call `onTransition(m.id, <target>)`.
- Use small ghost/outline buttons consistent with the current Accept/Reject icon buttons; label them (icon + text is fine given the flow needs clarity). Disable while in flight.
- Replace the current `pendingDecision` gate (`:92`) logic so buttons are chosen by the status→actions map above rather than lumping pending/in_progress/submitted together with only Accept/Reject.

### 5c. Cockpit page
Wherever `<MilestonesPanel .../>` is rendered (the cockpit passes `onCreate/onAccept/onReject` from the hook), pass `onTransition={transitionMilestone}` too.

### 5d. Timeline
Add `milestone_submitted` and `milestone_started` to the timeline icon/label map in `src/industries/it-agency/features/project-board/components/cockpit/timeline-panel.tsx` (it currently maps only `milestone_accepted`/`milestone_rejected`) so the new events render with a sensible icon.

---

## 6. Verification (Sonnet does locally; Opus re-runs)

1. `npm run build` clean; `npx eslint --max-warnings 0` clean on all changed/new files. **Confirm no migration added.**
2. **Full happy-path dogfood** (local, `admin@edgex.local`, a project cockpit):
   - Create a milestone → status `pending`. **Start** → `in_progress`. **Submit** → `submitted`.
   - Go to `/approvals` → the milestone now appears in the **Milestones** section (the whole point — verify through the real UI, not SQL).
   - **Accept** it from the inbox → `accepted`; it leaves the inbox.
   - Create another → Submit → **Reject** (from inbox or cockpit) → `rejected`, `rejection_reason` set and shown. **Reopen** → `in_progress`, `rejection_reason` cleared.
   - **Pull back** a submitted milestone → `in_progress`, leaves the inbox.
   - Cockpit **timeline** shows `milestone_submitted` / `milestone_started` events with icons.
3. **State-machine negatives:**
   - `POST /transition {to:"accepted"}` → 409 ("use the accept/reject action").
   - `POST /transition {to:"submitted"}` on an `accepted` milestone → 409.
   - Concurrent double-transition → one 200, one 409 (TOCTOU guard).
4. **Back-door closed:** `PATCH /api/v1/milestones/[id] {status:"submitted"}` no longer changes status (status field ignored / not persisted); title/amount/due_date edits still work.
5. **Access negatives:** non-admin it_agency user → `/transition` 403; non-it_agency tenant → 403.

---

## 7. Definition of done / hand-back
- `POST /milestones/[id]/transition` with the §2 state machine + `milestone_submitted`/`milestone_started` events + audit.
- Generic PATCH no longer writes `status`.
- Hook `transitionMilestone` + panel contextual buttons (Start/Submit/Pull back/Reopen) wired; timeline maps the new events.
- **No migration.** Build + lint clean; §6 dogfood + negatives + back-door check pass — especially: a milestone submitted via the UI shows up in `/approvals`.
- **STOP. Do not commit, open/modify a PR, push, or touch stage/prod.** Report: files changed, dogfood results (incl. the inbox round-trip), negatives, any deviations. Opus reviews the diff, re-runs gates, commits on this branch.

---

## 8. Deferred (note only)
Member-submit (needs a milestone owner/assignee column + migration + owner-scoped RLS), milestone edit UI wired to the now-status-free PATCH (title/amount/due_date), reorder via drag, due-date reminders, `in_progress` auto-set when a linked task starts.

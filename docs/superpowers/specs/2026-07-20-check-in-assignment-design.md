# Check-In Assignment — Design Spec

**Date:** 2026-07-20
**Scope:** `education_consultancy` only · Feature: `check-in` (shared feature, education gate)
**Status:** Approved design → ready for implementation plan
**Approach:** A — extend the existing check-in POST endpoint (atomic single call)

---

## Problem

On the Check-In page, when staff check in an **existing** lead, the check-in records a visit
(`lead_notes` row with `meet_with_id`) but never sets the lead's **owning counselor**
(`leads.assigned_to`). A checked-in lead can sit as **Assigned To: Unassigned** with no way to
assign or route it from the check-in surface. Staff have to leave check-in and go assign the lead
elsewhere. Close that gap: let check-in assign (and, for un-triaged leads, move to a pipeline
stage) in the same action — without disturbing the existing "Meet With" per-visit concept.

## Key domain distinction (do not collapse)

- **Meet With** (`lead_notes.meet_with_id`) — per-visit greeter/staff for *this* check-in. Optional.
  Stays exactly as-is. Never conflated with the owner.
- **Assigned To** (`leads.assigned_to`) — the lead's owning counselor. This is what we now let
  check-in set.

## Behavior model (stage-keyed, existing lead)

The right-hand **Lead Details** panel on `/check-in` gains an optional triage block whose controls
depend on the lead's **current stage** (`lead_lists` / `list_id`, rendered as "Stage" in the UI):

| Current stage | Panel adds (beyond existing Meet With) | Assigned To rule on Check In |
|---|---|---|
| **Prospect** (already in) | nothing — Meet With only | untouched (a Prospect already has a counselor) |
| **Qualified** | **"Assign To"** counselor picker (optional) | picked → that person · **blank + currently unassigned → the checker (`auth.userId`)** · blank + already assigned → leave unchanged |
| **Any other** (New, Pre-qualified, Applications, Archived) | **"Move to"** select (Qualified \| Prospect) → then **"Assign To"** picker | target **Qualified**: picked → that · blank → checker (if unassigned) · target **Prospect**: picked → that · **blank → move only, leave unassigned** (no checker fallback) |

Locked decisions:

- **Triage is optional.** Staff can still perform a plain check-in (visit + optional Meet With) with
  no move and no assignment. The controls are additive; leaving them empty = current behavior.
- **Education only.** Gate the whole behavior on `industryId === "education_consultancy"`. Other
  check-in industries (travel_agency) are unchanged.
- **Qualification block bypassed during check-in.** The existing hard-block that stops assigning a
  counselor to an unqualified student entering Prospects (`applyLeadPatch`) is **not** enforced on
  the check-in path. Check-in may assign / move-to-Prospect an unqualified lead.
- **Meet With untouched** in all cases.
- **Checker fallback only fills an empty owner** — it never silently overwrites an existing
  `assigned_to`. An explicit pick always wins.

## Approach A — extend the check-in POST (chosen)

Single atomic call. No second request, no changes to the shared `applyLeadPatch`.

### API — `POST /api/v1/leads/[id]/check-in`

File: `src/app/(main)/api/v1/leads/[id]/check-in/route.ts` (currently lines 23–196).

**New optional request body fields** (in addition to existing `meet_with_id`, `reason`):

```jsonc
{
  "meet_with_id": "uuid | null",     // existing — per-visit, unchanged
  "reason": "string?",                // existing
  "assign_to_id": "uuid | null",      // NEW — explicit owning counselor
  "move_to_stage": "qualified | prospect | null"  // NEW — target pipeline stage
}
```

**Server logic (education tenants only; for non-education, ignore the new fields):**

1. Insert the check-in `lead_notes` row exactly as today (`meet_with_id`, content, user). No change.
2. Resolve the lead's **current stage** from `list_id` (reuse the existing list-name resolution the
   auto-promotion block already uses).
3. **If `move_to_stage` is provided** (only meaningful for "other" stages): resolve the target
   `lead_lists` row by name (Qualified / Prospects) within the tenant, set `list_id`.
   - Determine assignment by target stage per the table (Qualified → picker-or-checker; Prospect →
     picked counselor, or move-only if the picker is blank — no checker fallback).
4. **Else, no move** — apply the current-stage rule:
   - Prospect → no assignment write.
   - Qualified → `assign_to_id` if provided; else checker (`auth.userId`) **only if currently
     unassigned**.
   - Other stage with no move → no assignment write (plain check-in).
5. Write `list_id` and/or `assigned_to` to the lead in **one** `leads.update(...).eq("id",id)
   .eq("tenant_id", auth.tenantId)` — the same shape as the existing promote update (route lines
   ~148–189). Keep it in the same request so the check-in + move + assign are atomic.
6. **Short-circuit the existing auto-promotion block** (lines ~84–194) when `move_to_stage` is
   explicitly provided — the explicit move/assign replaces the heuristic auto-promotion for that
   request. When no explicit move is sent, existing auto-promotion behavior is preserved unchanged.
7. Do **not** run the `applyLeadPatch` qualification hard-block — assignment here is a direct,
   bypassing write by design.

**Assignment side-effects note:** the existing self-assign in this route (elevated-performer path,
`assigned_to = auth.userId`) already writes `assigned_to` directly without the full collaborator/
branch-sync side-effects that `applyLeadPatch` performs. Decision for the plan: mirror that existing
lightweight write for consistency, and flag in the plan whether collaborator-sync
(`lead_branches`, permanent collaborator on new assignee) needs to be replicated here or is
acceptable to defer. Default: match the route's existing self-assign behavior (lightweight direct
write) to keep the change contained; call out the gap explicitly in the plan for a go/no-go.

### UI — check-in lead-details panel

File: `src/industries/_shared/features/check-in/ui.tsx`
- `handleCheckIn` (lines ~382–409); request body built ~line 391.
- Existing Meet With dropdown ~line 1339; `counselorMembers` ~line 207; team members via
  `getTeamMembers(tenantId)` in `page.tsx` ~line 36.

Changes (render only when `industryId === "education_consultancy"`):

1. Read the selected lead's current stage (already available in the selected-lead object used to
   render "Stage: …" in the panel).
2. Conditionally render the triage controls per the table:
   - **Prospect** → render nothing new.
   - **Qualified** → an "Assign To" counselor `Select` (source: `counselorMembers`, branch-scoped as
     the existing dropdowns are). Placeholder "Assign to (optional)".
   - **Other** → a "Move to" `Select` (options: Qualified, Prospect). When a target is chosen, reveal
     the "Assign To" picker. When target = Prospect, keep it a plain counselor pick; when Qualified,
     it's optional (blank = checker).
3. Include `assign_to_id` and `move_to_stage` in the `handleCheckIn` POST body (null when not set).
4. No change to Meet With handling.

### Data / migrations

None. `leads.assigned_to` and `leads.list_id` already exist; `lead_notes.meet_with_id` already
exists (migration 137). No schema change.

## Out of scope (YAGNI)

- No new "Assign To" control for already-in-**Prospect** leads (they're already owned).
- No change to Meet With semantics, storage, or history rendering.
- No change to travel_agency or any non-education check-in.
- No backfill of historically-unassigned checked-in leads.
- No collaborator/branch-sync parity with `applyLeadPatch` unless the plan's go/no-go elevates it.

## Verification (education tenant, dev/stage)

- Prospect-stage lead → panel shows Meet With only; check-in leaves `assigned_to` unchanged.
- Qualified-stage lead, pick a counselor → `assigned_to` = picked.
- Qualified-stage lead, leave blank, lead was Unassigned → `assigned_to` = checker.
- Qualified-stage lead, leave blank, lead already assigned → `assigned_to` unchanged.
- New/Archived lead, Move to Qualified + blank → moves to Qualified list, `assigned_to` = checker.
- New/Archived lead, Move to Prospect + pick counselor → moves to Prospects list, `assigned_to` =
  picked, even if the student is unqualified (block bypassed).
- New/Archived lead, Move to Prospect + blank picker → moves to Prospects list, `assigned_to`
  stays Unassigned (no checker fallback).
- Plain check-in (no move/assign) on any stage → visit recorded, Meet With optional, `assigned_to`
  untouched — identical to today.
- **Non-education tenant (travel_agency)** → no triage controls; check-in behaves exactly as today.
- Counselor-role checker → still only sees/acts within their assigned-lead scope (no regression to
  the counselor scoping rule).

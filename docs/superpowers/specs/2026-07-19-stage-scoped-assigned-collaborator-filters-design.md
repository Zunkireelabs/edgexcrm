# Stage-scoped "Assigned To" & "Collaborators" filters (education_consultancy)

**Date:** 2026-07-19
**Scope:** `education_consultancy` only. Branch: `filter` (off latest `origin/stage`).
**Type:** Client-only. No API route, no DB migration, no new props from server.

---

## Problem

On the leads list pages, the **Filters → Assigned To** and **Filters → Collaborators**
dropdowns build their option lists from the *full* team roster (`counselors` =
every team member in `memberMap`), each shown with a live count. Result:

- **Assigned To** lists everyone regardless of stage or role — including people who
  belong to a different stage's position and people with zero leads in the current stage.
- **Collaborators** lists every team member, including people who collaborate on
  zero visible leads (count 0 entries).

Desired: per-stage, role-aware option lists.

## Goal

For education_consultancy stage lists (`pre-qualified`, `qualified`, `prospects`,
`applications`):

1. **Assigned To** filter shows only the users relevant to that stage:
   - The stage's frontline position, **plus** branch managers (admin/owner viewer only).
   - Only users **actually assigned** to a lead in that stage (count > 0).
   - Plus an **Unassigned** option when unassigned leads exist.
2. **Collaborators** filter shows only **actual collaborators of visible leads**
   (drop zero-count roster entries).

Every other industry / list keeps current behavior — changes are strictly gated.

---

## Gate

Apply the new logic only when **both**:

- `industryId === "education_consultancy"`, AND
- `activeListSlug ∈ { "pre-qualified", "qualified", "prospects", "applications" }`

Otherwise fall through to the existing full-roster behavior (unchanged).

## Stage → frontline position

| Stage slug | Frontline position slug |
|---|---|
| `pre-qualified` | `lead-caller` |
| `qualified` | `lead-executive` |
| `prospects` | `counselor` |
| `applications` | `application-executive` |

Source of truth already exists: `STAGE_TEAM_MAP` in
`src/industries/education-consultancy/lead-assignment-by-stage.ts`
(each entry is `["branch-manager", <frontline>]`). The frontline slug = the non-`branch-manager`
member of that array. The new helper may derive from it or hard-map; hard-map is fine and clearer.

## Who sees the Assigned-To filter

Unchanged visibility gate in `leads-table.tsx`: `(isAdmin || isTeamScoped)`.
- **admin / owner** → team-scoped-equivalent, sees filter.
- **branch-manager** → `isTeamScoped === true`, sees filter.
- **counselor** and other own-scope members → filter hidden (own leads only). No change.

## Allowed assignee positions (per viewer)

New pure helper `allowedAssigneePositionsForStage(stageSlug, role, viewerPositionSlug)`:

```
frontline = STAGE_FRONTLINE[stageSlug]           // one of the 4 slugs above
if role is "admin" | "owner":        return Set{ frontline, "branch-manager" }
if viewerPositionSlug === "branch-manager":  return Set{ frontline }   // NO branch-manager
otherwise:                           return null   // caller falls back to full roster
```

Rationale for the branch-manager exclusion: spec says a branch manager sees **only**
the frontline role (e.g. only lead-callers in Pre-qualified), not other branch managers
nor themselves.

## Assigned-To option construction (rework of leads-table.tsx ~1195–1206)

When gated (education + known stage) and `allowed !== null`:

- **Unassigned** option: include only if `counselorCounts.get("unassigned") > 0`.
- For each `[userId, email]` in `counselors`, include only if **both**:
  - `counselorCounts.get(userId) > 0` (actually assigned in this stage's visible leads), AND
  - `positionSlugMap[userId]` is in `allowed`.
- Label/description/count formatting unchanged.

When not gated (other industry/list, or `allowed === null`): keep the current
full-roster option list exactly as-is.

**Branch scoping** ("branch managers of branches present in the list") is satisfied
implicitly: because we only include users with `count > 0`, a branch manager appears
only if they are actually assigned to a lead in this stage list — which ties them to
a branch present in the list. No `branch_id` prop or `listBranchIds` set is needed.

## Collaborators option construction (rework of leads-table.tsx ~1222–1227)

When gated (education + known stage):

- Keep only `[userId, email]` where `collaboratorCounts.get(userId) > 0`.

When not gated: unchanged (current full-roster behavior).

*(Collaborators fix is deliberately kept education+stage-gated too, per the
"education_consultancy only" instruction — even though a zero-count drop would be a
correct behavior everywhere.)*

---

## Files

| File | Change |
|---|---|
| `src/lib/leads/stage-assignee-positions.ts` *(new)* | Pure helper `allowedAssigneePositionsForStage()` + `STAGE_FRONTLINE` map. No React, no imports from client code. Unit-testable. |
| `src/components/dashboard/leads-table.tsx` | Import helper; add a `gated` boolean (`industryId === "education_consultancy" && STAGE_FRONTLINE[activeListSlug]`); rework the Assigned-To options block (~1195) and Collaborators options block (~1222) as above. |

No changes to `page.tsx`, API routes, or DB. `positionSlugMap`, `industryId`,
`activeListSlug`, `role`, `isTeamScoped`, `currentUserPositionSlug` are already props.

## Verification (must confirm during impl)

- `positionSlugMap` is populated for all members on the leads page (it is already used
  for assignee auto-routing at leads-table.tsx ~602). Confirm it covers every assignable member.
- `role` prop value strings — confirm admin/owner detection uses the existing
  `isAdmin = role === "admin" || role === "owner"` already computed at ~281.

## Test matrix (manual, dev/stage as Admizz)

Log in to dev as an Admizz **admin** and as a **branch-manager** (`edgexdev123`):

1. **Pre-qualified**, admin → Assigned-To lists only assigned lead-callers + assigned
   branch managers; unassigned option present iff unassigned leads exist; no lead-executives/counselors.
2. **Pre-qualified**, branch-manager → Assigned-To lists only assigned lead-callers
   (no branch managers, not self).
3. **Qualified** → frontline = lead-executive. **Prospects** → counselor. **Applications** → application-executive.
4. **Collaborators** filter (any of the 4 stages) → lists only users who collaborate on a visible lead; no zero-count entries.
5. Counselor login → Assigned-To / Collaborators filters still hidden.
6. Non-education tenant (IT agency) or an admin-only list → filters unchanged (full roster).

---

## Out of scope

- No change to who is *assignable* (the assign dropdown / `assignable.ts`) — filter options only.
- No change to lead visibility / data fetch.
- No server-side / API filter-option endpoint.

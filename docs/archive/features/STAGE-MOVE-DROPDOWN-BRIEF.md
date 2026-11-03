# BRIEF — Stage-move dropdown + coupled assignee picker (education_consultancy)

**Owner industry:** education_consultancy only. Gate all new behavior with `industryId === "education_consultancy"`.
**Scope:** lead detail page → KEY INFORMATION → **Stage** control.
**Executor:** Sonnet. **Base branch:** latest `origin/stage`. **Do NOT push/PR without asking.**

---

## Problem (verified)

1. Admin clicked "Send to next" and got a **plain confirm** ("Move this lead to Qualified? Confirm") instead of an assignee picker.
   - Root cause: for admins/branch-managers the picker is populated from the **destination stage's handlers filtered to the lead's branch** (`src/app/(main)/(dashboard)/leads/[id]/page.tsx:200-229`). `STAGE_TEAM_MAP["qualified"] = ["branch-manager","lead-executive"]`. The KTM-branch lead had **no lead-executive and no branch-manager in KTM** → `nextPositionMembers = []` → `showAssigneePicker=false` (`list-stepper.tsx:139-141`) → plain confirm. Data gap surfacing as silent fallback.
2. "Send to next" is **strictly linear** (next stage only — `list-stepper.tsx:99,204`). User wants to move to **any** stage (forward or back) from one dropdown, with the assignee picker coupled to whichever destination is chosen.

## Approved design (4 decisions, user-confirmed)

- **Control:** For **admins + branch-managers** (owner/admin baseTier, or `leadScope === "team"`, or branch-manager position), replace the linear `ListStepper` with a **single "Move to stage" dropdown** listing **all active (non-archive, non-staging) stages, any direction**. Current stage shown/disabled.
- **Assignee (coupled) — position-specific, not "whole branch":** On picking destination stage `S`, the **Assign to** picker lists the **line-position team for that stage in the lead's branch**, where line position = `STAGE_TEAM_MAP[S]` minus `branch-manager`:
  - `pre-qualified → lead-caller`, `qualified → lead-executive`, `prospects → counselor`, `applications → application-executive`.
  - Example: admin picks **Qualified** → picker = the branch's **lead-executives + branch-manager**.
  - **Viewer distinction:**
    - **Admin/owner viewer** → line team of branch **+ branch-manager** of that branch.
    - **Branch-manager viewer** → line team of that branch **only** (they delegate down; branch-manager is NOT an option for themselves). Their branch = the lead's branch.
- **Fallback (this is the fix for the plain-confirm bug):** if the line-team-in-branch list is empty →
  1. branch-manager(s) of the **lead's branch**; else
  2. the line-position team **tenant-wide** (ignore branch).
  Picker should essentially never be empty. (Fallback may surface a branch-manager even for a branch-manager viewer, only to avoid a dead-empty picker.)
- **Revert:** same dropdown handles backward moves — a backward stage is just another pick and gets the **same** assignee picker + fallback. No separate revert dialog for admins/branch-managers.
- **Chain members (lead-caller/lead-executive/counselor/application-executive):** **UNCHANGED.** Keep the existing linear `ListStepper` (next-only + revert-to-previous-holder). Do not regress their flow.

## Server (mostly already works — verify, don't rebuild)

`PATCH /api/v1/leads/[id]` (`src/app/(main)/api/v1/leads/[id]/route.ts`):
- Client passes `list_id` + explicit `assigned_to`. Because `assigned_to !== undefined`, the auto-revert governance block (`:604-644`) is **skipped** → admin's chosen assignee wins in **both** directions. ✅ No change needed there.
- Prospects %/GPA gate (`:592-599`) is independent of assignee → still enforced. ✅
- **VERIFY:** the route allows an admin/branch-manager to move to **any active stage in any direction** (find the accessible-lists / allowed-destination check earlier in the PATCH handler and confirm admins aren't restricted to neighbors). If it restricts to neighbors, widen for admin/team scope only.
- **VERIFY:** an assignment-history row is written whenever `assigned_to` changes on a move (needed so chain members' revert defaults keep working). If not, add it.

## Client work

- **page.tsx** (`src/app/(main)/(dashboard)/leads/[id]/page.tsx`): when `canMoveWithoutChain` (already computed `:200-203`), replace the single-next `nextPositionMembers` computation with a **map for every active stage**: `stageAssigneeMap: Record<listId, NextPositionMember[]>`, each built with the branch → branch-manager → tenant-wide fallback chain above. Pass it to the new control. Keep the existing `nextPositionMembers`/`revertTargetMembers` path for chain members.
- **New component** (e.g. `src/components/dashboard/leads/stage-move-selector.tsx`): dropdown of all active stages + coupled assignee `Select`. Reuse `moveConfirmMessage`, the assignee `Select` markup, and the Prospects-gate awareness pattern from `list-stepper.tsx:289-315`. `onMove(listId, assignToUserId)` signature is already wired through `onListChange` (`key-info-section.tsx:277`) — reuse it.
- **key-info-section.tsx** (`:263-284`): branch — render `StageMoveSelector` when the viewer is admin/branch-manager (education), else the existing `ListStepper`.
- Reuse `STAGE_TEAM_MAP` / `positionsForStage` (`src/industries/education-consultancy/lead-assignment-by-stage.ts`). Add a helper there for the fallback chain rather than inlining it.

## Guardrails / gotchas

- Education-only: every new branch guarded by `industryId === "education_consultancy"`. Non-education tenants and chain members see no change.
- Prospects gate: dropdown must surface the same "Add %/GPA before Prospects" validation error the server returns — don't let the move silently 400.
- Don't move stage-selector logic into a shared file that non-education pipelines read.
- Tenant isolation: any new roster/branch query stays tenant-scoped.

## Done when

- `npm run build` clean, no new `any`.
- As **Admizz admin**, lead detail Stage shows a dropdown of all stages; picking any stage (fwd or back) shows an Assign-to picker that is **populated** (branch → branch-manager → tenant-wide fallback), never the old plain confirm.
- Moving to Prospects without %/GPA still blocked.
- As a **chain member** (e.g. lead-caller), Stage still shows the linear next/revert stepper — unchanged.
- Non-education tenant: Stage control unchanged.

## Report back

Return: files touched, the server-side verification findings (2 VERIFY items above), and screenshots of the dropdown + populated assignee picker for both a forward and a backward pick as an admin.

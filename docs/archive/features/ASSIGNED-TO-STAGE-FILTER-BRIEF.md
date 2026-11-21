# BRIEF — Filter the standalone "Assigned To" dropdown by the lead's current stage (education)

**Owner industry:** education_consultancy only. **Executor:** Sonnet. **Base:** latest `origin/stage` (includes #225 + #224). **Do NOT push/PR without asking.**

Follow-up to #225. #225 filtered the assignee picker inside the **Stage-move** control. This does the same for the **standalone "Assigned To"** dropdown on the lead-detail KEY INFORMATION panel.

---

## Problem

The standalone **Assigned To** dropdown (`key-info-section.tsx:326-379`, options from `resolvedAssignable` at `:171`, sourced from `assignableMembers` = `filterAssignableMembersByChain(...)` at `page.tsx:167-174`) is **not stage-filtered**:
- Admin → sees **all** tenant members.
- Branch-manager (`leadScope==="team"`) → sees same-branch members minus self.

User wants it scoped to the **current stage's team in the lead's branch**, same rule as #225:
- Current stage **Qualified** → options = the branch's **lead-executives + branch-manager** (admin viewer) / **lead-executives only** (branch-manager viewer).
- Generalized via `STAGE_TEAM_MAP` (`pre-qualified→lead-caller`, `qualified→lead-executive`, `prospects→counselor`, `applications→application-executive`).

## Approved design (user-confirmed scope: **admins + branch-managers only**)

For viewers where `canMoveWithoutChain` is true (the flag already computed in `page.tsx` for #225: education + `!isChainMember` + baseTier `admin`/`owner` OR `leadScope==="team"`), replace the Assigned-To options with the **current stage's** candidates:

```ts
// page.tsx — reuse the #225 helper, but for the lead's CURRENT stage (not the destination)
const currentStageSlug = /* slug of the lead's current list (leadListId).
   Resolve from activeLeadLists/allLists — page.tsx already looks up the current LeadList near :105 */;
const stageScopedAssignees = canMoveWithoutChain
  ? stageAssigneeCandidates(roster, currentStageSlug, leadBranchId, isBranchManagerViewer)
  : null;
```

- When `stageScopedAssignees` is non-null, pass **it** as the Assigned-To options instead of `assignableMembers`. When null (chain members, non-education), keep the existing `filterAssignableMembersByChain` result unchanged.
- `stageAssigneeCandidates` already has the never-empty fallback (branch line-team → branch-manager(s) of branch → line team tenant-wide) — reuse as-is, do not fork it.

## Must preserve

- **Current assignee always visible.** `key-info-section.tsx:171` (`resolvedAssignable`) injects the current assignee even if outside the option set — keep this. Otherwise a lead already assigned to someone outside the stage team would show a blank/there'd be no way to see who holds it. The new stage-scoped list must still be unioned with the current assignee via that same mechanism.
- **"Unassigned" option** stays.
- **Branch-manager viewer** gets line team only (no branch-manager entry) — `stageAssigneeCandidates(..., viewerIsBranchManager=true)` already does this.
- **Chain members** (lead-caller/lead-executive/counselor/application-executive) — UNCHANGED (keep `filterAssignableMembersByChain`; their Assigned-To already shows same-position peers).
- **Non-education** tenants + it_agency (which also render `KeyInfoSection` via account/contact detail) — UNCHANGED. Guard on `industryId === "education_consultancy"` (already baked into `canMoveWithoutChain`).

## Server

`PATCH /api/v1/leads/[id]` currently does **not** validate `assigned_to` against the current stage (only tenant membership + chain rules). This is a **UI-only** change — leave the server as-is (admins are trusted within their tenant; #225 set the same precedent). *Optional* future hardening: a server-side stage-team check, but NOT in this PR.

## Done when

- `npm run build` clean, `npm run lint` 0 errors, no new `any`.
- As **Admizz admin** on a **Qualified** lead in **Birgunj**: Assigned-To dropdown lists only Birgunj's lead-executives + branch-manager (+ current assignee if set, + Unassigned).
- As a **branch-manager**: same but lead-executives only.
- As a **chain member**: Assigned-To unchanged.
- Lead already assigned to someone off the stage team → that person still shows in the dropdown (not hidden).
- Non-education tenant / it_agency contact detail: Assigned-To unchanged.

## Report back

Files touched, plus screenshots of the Assigned-To dropdown for (a) admin on a Qualified lead, (b) branch-manager on same, (c) a chain member (unchanged), and (d) confirmation the current-assignee-still-visible case works.

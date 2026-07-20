# Design — Application panel: access control + drag-reorder

**Date:** 2026-07-13
**Industry scope:** `education_consultancy` only (application-tracking is already industry-scoped)
**Feature:** `FEATURES.APPLICATION_TRACKING`
**Branch:** `feature/view-application` (off `origin/stage`)

---

## 1. Problem

On the lead-detail page, the **APPLICATIONS** panel (`applications-card.tsx`) lists a student-lead's university applications. Today:

- **Edit/create** is gated by a coarse position check — `canEditApplication()` allows owner/admin **or** anyone holding the `branch-manager` / `application-executive` position, regardless of which branch the lead belongs to and regardless of whether they are the assignee.
- **View** is parent-lead scope (`getApplicationWithAccess`); an own-scope user who was a collaborator but got reassigned away is **blocked**.
- There is **no way to reorder** applications; they render in fetch order.

We want a precise, branch-aware, assignee-aware access model plus manual drag-reorder of the cards.

## 2. Desired behavior

| Capability | Who |
|---|---|
| **View** applications | Anyone who can view the parent lead **including lead collaborators** (`lead_collaborators`) — even after reassignment. |
| **Create** an application | owner/admin · branch-manager of the lead's assigned branch · the **lead assignee** (`lead.assigned_to`). |
| **Edit** an application | owner/admin · branch-manager of the lead's assigned branch · the **application assignee** (`applications.assigned_to`). |
| **Delete** an application | Same set as Edit. UI shows a **confirmation dialog** before deleting. |
| **Reorder** applications (drag) | owner/admin · branch-manager of the lead's assigned branch · the **lead assignee**. |

Definitions:
- **Assigned branch** = `lead.branch_id` (the lead's current branch — *not* the `lead_branches` origin row).
- **Branch manager** = `auth.positionSlug === "branch-manager"` **and** `auth.branchId === lead.branch_id`.
- **No position gets blanket edit.** An `application-executive` edits an application **only** when they are its assignee. As a mere collaborator → view-only. (This is the deliberate behavior change vs. today's `canEditApplication`.)

## 3. Authorization — one truth function

Add to `src/lib/api/applications.ts` (co-located with `getApplicationWithAccess`):

```ts
// lead: { id, assigned_to, branch_id }; application optional (absent on create)
export function canManageApplicationForLead(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id: string | null },
  application?: { assigned_to: string | null } | null,
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  // branch manager of the ASSIGNED branch
  if (auth.positionSlug === "branch-manager" && auth.branchId && auth.branchId === lead.branch_id) return true;
  // application assignee (edit/delete of an existing card)
  if (application && application.assigned_to === auth.userId) return true;
  return false;
}
```

**Create** and **reorder** operate before/across individual application rows, so they use the parent-lead assignee instead of the app assignee:

```ts
export function canCreateOrReorderApplications(
  auth: AuthContext,
  lead: { assigned_to: string | null; branch_id: string | null },
): boolean {
  const p = auth.permissions;
  if (p.baseTier === "owner" || p.baseTier === "admin") return true;
  if (auth.positionSlug === "branch-manager" && auth.branchId && auth.branchId === lead.branch_id) return true;
  if (lead.assigned_to === auth.userId) return true; // lead assignee
  return false;
}
```

`getApplicationWithAccess` currently fetches `parentLead (id, assigned_to, branch_id)` and `membership` internally but does not return them. **Extend it to return `{ parentLead, membership }`** so PATCH/DELETE routes can call `canManageApplicationForLead` without a second query.

### Create — no auto-assign
Do **not** auto-set `applications.assigned_to` on create. The assignee is only whatever is explicitly chosen (or left empty). Rationale: owner/admin and branch managers create applications but must **not** become the assignee. Consequence: a creator who is not owner/admin/branch-manager can edit the card afterward only if they are explicitly set as its assignee.

## 4. View includes collaborators

Add a collaborator bypass to the view path so a lead collaborator can read applications even when own-scope and not currently assigned:

- In `getApplicationWithAccess`: before returning `allowed:false`, if `await isLeadCollaborator(db, auth.tenantId, lead_id, auth.userId)` → `allowed:true` (view).
- In the panel list route `GET /api/v1/leads/[id]/applications`: mirror the lead-detail view scope (which already admits collaborators). Confirm it does; if it re-derives scope, add the same collaborator bypass.

`isLeadCollaborator` lives at `src/lib/leads/collaborators.ts`.

## 5. Reorder

### Migration `supabase/migrations/NNN_application_position.sql`
> `NNN` = next free number from `ls supabase/migrations/ | sort` (do not reuse). One file, additive, wrapped in a transaction, with a rollback line and before/after counts.

```sql
BEGIN;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS position INTEGER;

-- backfill per lead by creation order
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY lead_id ORDER BY created_at, id) - 1 AS rn
  FROM applications
  WHERE deleted_at IS NULL
)
UPDATE applications a SET position = o.rn FROM ordered o WHERE a.id = o.id;

CREATE INDEX IF NOT EXISTS idx_applications_lead_position ON applications (lead_id, position);
COMMIT;

-- Rollback:
-- DROP INDEX IF EXISTS idx_applications_lead_position;
-- ALTER TABLE applications DROP COLUMN IF EXISTS position;
```
Apply to **stage** (`dymeudcddasqpomfpjvt`) first, verify, then to **prod** (`pirhnklvtjjpuvbvibxf`) at promotion time (per-action approval). Migration lands on prod **before** the code merges to `main`.

### Ordering
- Panel list (`GET /leads/[id]/applications`) orders by `position ASC NULLS LAST, created_at ASC`.
- New applications get `position = (max position for that lead) + 1` (or `count`). Set in the create routes.

### Reorder endpoint
New route `src/app/(main)/api/v1/leads/[id]/applications/reorder/route.ts`, `PATCH`:
- `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)` → load parent lead `(id, assigned_to, branch_id)` scoped to tenant → `canCreateOrReorderApplications(auth, lead)` else `apiForbidden()`.
- Body `{ orderedIds: string[] }`. Validate: all ids belong to this `lead_id` + tenant, none deleted, set is complete (no foreign/missing ids). Reject otherwise (`apiValidationError`).
- Write `position = index` for each id (bulk update / single txn via `scopedClient`).
- Audit log `application.reordered`.

## 6. UI — `applications-card.tsx`

- Replace the plain `<Link>` card list with `@dnd-kit` sortable (`@dnd-kit/core` + `@dnd-kit/sortable` — already used elsewhere in the app; reuse the same pattern as the board / leads DnD).
- **DnD enabled only when `canManage`.** Collaborators / view-only users get a static list (current behavior).
- Click still navigates to `/applications/[id]`; drag uses a handle or press-delay so click vs drag don't conflict.
- On drag end: optimistic reorder in local state → `PATCH /leads/[id]/applications/reorder` with the new `orderedIds` → on failure, revert + toast.
- Delete affordance (wherever a card can be deleted — application detail page primarily) shows a **confirm dialog** before calling DELETE.

## 7. Gate swaps

| File | Current gate | New gate |
|---|---|---|
| `api/v1/applications/[id]/route.ts` `PATCH` | `canEditApplication(perms, slug)` | `canManageApplicationForLead(auth, parentLead, existingApp)` (using the lead+app now returned by `getApplicationWithAccess`) |
| `api/v1/applications/[id]/route.ts` `DELETE` | `canDeleteApplication(perms)` | `canManageApplicationForLead(auth, parentLead, existingApp)` |
| `api/v1/applications/route.ts` `POST` | `canManageApplications` flag | `canCreateOrReorderApplications(auth, lead)` (no auto-assign) |
| `api/v1/leads/[id]/applications/route.ts` `POST` | `canManageApplications` flag | `canCreateOrReorderApplications(auth, lead)` + set `position` (no auto-assign) |
| `api/v1/leads/[id]/applications/route.ts` `GET` | lead scope | + collaborator view bypass; order by `position` |
| `components/dashboard/lead/lead-detail-v2.tsx` | position-based `canManage` for the panel | compute `canManage = canCreateOrReorderApplications(auth, lead)` server-side so the panel's Add/drag controls match the API |

`getApplicationWithAccess` extended to also return `{ parentLead, membership }`.

Leave the old `canEditApplication` / `canDeleteApplication` / `canManageApplications` helpers in place only if still referenced elsewhere; otherwise remove to avoid two competing models. Grep before deleting.

## 8. Out of scope (YAGNI)

- Reordering on the standalone Kanban **board** (`applications-board.tsx`) — board still groups by stage / orders by `created_at`. This spec covers the **lead-detail panel** only.
- Cross-branch (multi-branch shared lead) manager access — assigned branch = `lead.branch_id` only.
- Per-stage assignee concept — not introduced.

## 9. Verification

- `npm run build` clean (`NODE_OPTIONS=--max-old-space-size=8192`).
- As **owner/admin**: view/add/edit/delete/reorder all work.
- As **branch-manager** whose branch == lead.branch_id: full manage. As branch-manager of a *different* branch: view-only (no add/edit/delete/reorder; API 403).
- As the **application's assignee** (non-manager): can edit/delete that card; cannot reorder unless also lead assignee.
- As **lead assignee**: can add + reorder.
- As a **lead collaborator** (reassigned away, own-scope): can view the panel; Add/drag hidden; PATCH/DELETE/reorder → 403.
- Non-education tenant: feature 404/403 unchanged.
- Migration verified on stage (before/after counts) before prod.

## 10. Open items to confirm during review

- **Reorder by an app-assignee-only user:** a user assigned to *one* card but not the lead is **not** granted whole-list reorder (reorder uses lead-assignee rule). Acceptable? (Current choice: yes, keep simple.)
- **Removing the legacy helpers** vs. leaving them for other call sites — depends on grep results.

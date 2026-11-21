# Brief — Phase C + D: delivery capabilities on positions (`it_agency`)

**Author:** Opus planning session · **Date:** 2026-09-06 · **Executor:** Sonnet session
**Base branch:** `origin/stage` (Phase A merged as `b82f281f`, live on stage)
**Parent doc:** `docs/IT-AGENCY-POSITIONS-RBAC-BRIEF.md` — read §Background and §Phase C/D first.

**Ships as ONE PR.** Phase C alone is invisible and actively misleading: the server would authorize a
Delivery Lead while three client-side `isAdmin` gates still render read-only UI. That is precisely the
#500 → #501 defect (correct server authz, front end that can't reach it). C and D land together so the
PR is verifiable as a user story: *assign someone Delivery Lead, they can run a project end to end.*

Phase B (the `counselor` → `staff` rename) is **not** part of this and is not a prerequisite. Its gate
is now cleared (see below) but it is sequenced after this work.

---

## What changed since the parent brief was written

Facts established on 2026-09-06 that this phase depends on — none of them are assumptions:

1. **Phase A is live on stage.** Mig 225 applied in deploy run 34026877032. Migrate log:
   `it_agency positions: 3 -> 13`, `tenant_users with position_id: 3 -> 7`.
2. **The parent brief's "it_agency has zero positions" premise was wrong for stage.** Three
   hand-made positions already existed on Zunkiree: **CEO**, **Business Development Executive**,
   **Developer** — all `member` tier, holding 3 real users (Deepika = BDE, Manjila + hardik = Developer).
   Mig 225 correctly left them untouched (`position_id IS NULL` guard). They matter here: after this
   PR, granting hardik delivery access means ticking `canManageProjects` on **Developer**, not moving
   him to Delivery Lead. Do not modify those three positions in this PR.
3. **The null-position audit is clean on both DBs.** Every `tenant_users` row without a position is
   `owner` or `admin` (prod: 8 rows, stage: 4 rows; zero `counselor`, zero `viewer`). Owner/admin take
   the hard override at `permissions.ts:47`, so the position-less branch of `resolvePermissions`
   is effectively dead code in production.
4. **`getCurrentUserTenant()` already returns `permissions: ResolvedPermissions`**
   (`src/lib/supabase/queries.ts:18,58-65`). Phase D needs **no new plumbing** — the page shells can
   read the resolved booleans directly and pass them down.

---

## Phase C — the capability keys

### C1. Extend `PositionPermissions` (`src/lib/api/permissions.ts`)

Three new optional booleans. Follow `canManageHR` exactly — it is the closest existing precedent
(optional, defaults false, admin-only by default, position may grant).

| Key | Governs |
|---|---|
| `canManageProjects` | project create/edit/delete/qualify, every project sub-resource (milestones, risks, issues, change requests, status reports, retro lessons, contacts, commit-plan), and task delete/reconcile |
| `canApproveTime` | time-entry approve/reject, timesheet compliance, the approvals queue |
| `canManageBilling` | project invoices, and the `is_billable` field guard on task creation |

Touch five places in that file:

1. `interface PositionPermissions` — add the three as `?: boolean` with a one-line comment each,
   matching the existing comment style ("Absent ⇒ default per resolver").
2. `interface ResolvedPermissions` — add the three as non-optional `boolean`.
3. `resolvePermissions` — **all three branches**:
   - owner/admin hard override → `true`
   - no position configured → `false` (reproduces today exactly: only owner/admin pass `requireAdmin`)
   - position configured → `p.canX === true`
4. `validatePositionPermissions` — three optional-boolean checks, copying the `canManageHR` block.
5. Check helpers next to `canManageHR(p)` — `canManageProjects(p)`, `canApproveTime(p)`,
   `canManageBilling(p)`.

**Behaviour-neutrality is the acceptance criterion for C1.** Before this PR, exactly the set
{owner, admin} passes every one of the 22 gates. After C1 and before anyone edits a position, the same
set must pass. If a test can distinguish the two states, the defaults are wrong.

Note: `canExport` and `canSendSms` are deliberately hardcoded `false` for members even when the JSONB
sets them (`permissions.ts:104-105`). Do **not** copy that pattern here — these three keys ARE meant to
be grantable by position. That asymmetry is intentional; don't "fix" it either way.

### C2. Convert the 22 gates

Replace `if (!requireAdmin(auth)) return apiForbidden();` with the mapped capability check, reading
`auth.permissions`. Paths relative to `src/app/(main)/api/v1/`. **This list is exhaustive — verify with
`grep -rn "requireAdmin(auth)) return apiForbidden" projects tasks time-entries approvals` and confirm
you get exactly 22 before and 0 after.**

**`canManageProjects` — 16**

| File | Line |
|---|---|
| `projects/route.ts` | 83 |
| `projects/[id]/route.ts` | 88, 226 |
| `projects/[id]/qualify/route.ts` | 34 |
| `projects/[id]/status-reports/route.ts` | 51 |
| `projects/[id]/change-requests/route.ts` | 52 |
| `projects/[id]/commit-plan/route.ts` | 22 |
| `projects/[id]/contacts/route.ts` | 96, 203, 310 |
| `projects/[id]/milestones/route.ts` | 51 |
| `projects/[id]/risks/route.ts` | 52 |
| `projects/[id]/issues/route.ts` | 54 |
| `projects/[id]/retro-lessons/route.ts` | 30 |
| `tasks/[id]/route.ts` | 217 |
| `tasks/[id]/reconcile/route.ts` | 28 |

**`canApproveTime` — 4**
`time-entries/compliance/route.ts:55` · `time-entries/[id]/approve/route.ts:33` ·
`time-entries/[id]/reject/route.ts:34` · `approvals/route.ts:35`

**`canManageBilling` — 2 + 1 field guard**
`projects/[id]/invoices/route.ts:37, 97` · plus `projects/[id]/tasks/route.ts:135`, where
`requireAdmin(auth)` guards the `is_billable` *field* rather than the route — convert the expression,
keep the field-guard shape.

**Do NOT touch** `requireAdmin` in `team/route.ts`, `invites/route.ts`, or `positions/[id]/route.ts`.
Team administration stays admin-only in this round. Leave `requireAdmin` itself unchanged — it is used
across ~35 other routes.

`PATCH /api/v1/tasks/[id]` (the own-vs-admin + claim-unassigned logic from #500) is **out of scope** —
it is not one of the 22 and its rules are already correct. Do not refactor it.

---

## Phase D — make it visible

### D1. Position editor (`src/components/dashboard/settings/positions-manager.tsx`)

Three checkboxes inside the existing `form.base_tier === "member"` block, so they never show for admin
tier (which already has everything). `canManageHR` is the pattern to copy verbatim — lines
`60` (form type), `100` (default in `buildDefaultForm`), `125` (serialize in the payload builder),
`146` (deserialize in `formFromPosition`), `610-612` (the JSX checkbox).

Group the three under a "Delivery" sub-heading if the panel supports one; otherwise keep them adjacent
and label them plainly ("Manage projects & tasks", "Approve timesheets", "Manage project billing").

### D2. The three client-side gates — this is the part that makes the PR real

| File | Line | Today | Becomes |
|---|---|---|---|
| `project-board/pages/project-cockpit.tsx` | 34 | `const isAdmin = role === "owner" \|\| role === "admin"` | driven by `canManageProjects` |
| `project-board/pages/tasks-workspace.tsx` | 19 | same | driven by `canManageProjects` |
| `project-board/pages/workspace.tsx` | 22 | `const canCreate = role === "owner" \|\| role === "admin"` | driven by `canManageProjects` |

Thread the resolved booleans from the server components — `getCurrentUserTenant()` already returns
`permissions`, so `src/app/(main)/(dashboard)/projects/page.tsx`,
`projects/[id]/page.tsx` and `tasks/page.tsx` pass them as props alongside the existing `role`.
**Do not re-derive permissions client-side and do not fetch them over the network.**

Then follow the prop down: an `isAdmin` prop that now means "can manage projects" must be **renamed**
at every consumer in `project-board/` (`grep -rn "isAdmin" src/industries/it-agency/features/project-board/`).
A boolean whose name no longer matches its meaning is how the next reader introduces the next bug.

Two consumers need thought rather than a blind rename — check what each actually gates:
- `BillableSummary` and the invoices block in `project-cockpit.tsx:138-141` are **billing**, so they
  take `canManageBilling`, not `canManageProjects`.
- `TimelinePanel`'s `onAddRetroLesson` maps to the retro-lessons route → `canManageProjects`.

### D3. Sidebar / nav

No change. `/projects`, `/tasks`, `/time-tracking`, `/approvals` are already in the nav catalog via the
it_agency manifest (`buildNavCatalog`, `src/lib/settings/catalogs.ts:38`), so a position can already
allow/deny them. Nav visibility and write capability are separate axes — do not couple them.

---

## Tests

Unit (`src/lib/api/permissions.test.ts`):
- All three keys `true` for owner and admin regardless of position.
- All three `false` for a member with no position — **the behaviour-neutrality guard**.
- Each key `true` only when the position JSONB sets it `true`; absent/`false`/garbage ⇒ `false`.

Route tests — one per capability group, following the existing mocks in `projects/route.test.ts` and
`projects/[id]/tasks/route.test.ts`:
- member position **with** the flag → 200
- member position **without** it → 403
- owner/admin → 200 regardless of position

Regression: assert that a member with `canManageProjects` still gets 403 from
`POST /api/v1/invites` and `PATCH /api/v1/team` — proves the capability didn't leak into team admin.

---

## Local verification (required before the PR)

On the local Supabase stack with mig 225 applied, as an it_agency tenant:

1. Create a member position with **only** `canManageProjects` ticked. Assign a test user.
2. As that user: create a project, edit it, add a milestone and a risk, delete a task. All succeed.
3. Same user: the approvals queue and the invoices block are **not** available (403 / hidden) —
   proves the keys are independent, not one blanket "delivery admin".
4. Tick `canApproveTime` on that position; approve a timesheet entry. Succeeds.
5. As a member position with **no** delivery flags: `/projects` and `/tasks` still render read-only,
   no 403 toasts, and the "New Project" button is absent — proves the neutral default.
6. As owner: everything works exactly as before this PR.

**Screenshots required** for steps 2, 3 and 5 — this is a UI-visible phase, and a phase without a
screenshot is not verified.

---

## Gates

- Base `stage`, squash merge, **1 approval from a second human** (Anish / `ani-shh`). Never `main`.
- `npm run lint` (**not** `npx eslint` — it skips config and has reported 0 errors on a branch CI failed),
  `npx tsc --noEmit`, `npm run test` all clean locally before pushing.
- No migration in this PR. Mig 225 already seeded the `canManage*` keys onto Delivery Lead, and
  `resolvePermissions` ignores unknown JSONB keys — so those seeds activate the moment C1 lands, with
  no second migration. Verify that is true rather than assuming it: after C1, a user on **Delivery
  Lead** should pass the delivery gates with no DB change.
- **No hand-applied SQL, stage or prod.**
- Stop at review. Do not self-merge. Opus re-reads the diff and re-runs the gates independently.

## Out of scope

- Phase B (`counselor` → `staff`). Separate PR, sequenced after this.
- Prod promotion of anything. Still gated on confirming migs 128 / 130–136 are on the prod schema via
  `scripts/migrate-status.sh`.
- The three hand-made positions (CEO / BDE / Developer). Granting them delivery flags is a config
  action for Sadin after this ships, not a code or migration change.
- `requireAdmin` itself, team/invite administration, and `PATCH /api/v1/tasks/[id]`.

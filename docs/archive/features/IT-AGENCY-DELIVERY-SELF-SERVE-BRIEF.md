# BRIEF — it_agency Delivery: make Projects & Tasks self-startable

**Author:** Opus (planner) · **Executor:** Sonnet · **Date:** 2026-09-05
**Tenant/industry:** Zunkiree Labs, `it_agency` · **Base branch:** latest `origin/stage`
**Migrations:** one — `224_projects_optional_account.sql`

---

## Why

The `it_agency` delivery surface is deep and already shipped (migs 020→135; PRs #159/#160/#167/#168):
`/projects` board+table, a 5-tab project cockpit, milestones, issues, change requests, status
reports, approvals inbox, task timers, timesheet compliance. **The engine is built; the on-ramps are
missing or broken.** Nobody can self-start, so the feature isn't being adopted.

Audit findings (all verified in code):

1. **No `+ New Project` on `/projects`.** `project-board/components/workspace-header.tsx` has
   search, filters and a Board/Table toggle — no create button. The only manual create path in the
   whole app is the `ProjectForm` dialog triggered from `/accounts/[id]` → Projects tab
   (`accounts/components/account-detail/projects-tab.tsx:47`). Creation is *not* gated behind a
   proposal or deal — `POST /api/v1/projects` needs only `name` + `account_id` — it's just
   undiscoverable. `docs/STATUS-BOARD.md` already lists "`+ New Project` button" as a parked
   `/projects` follow-up.
2. **`/tasks` has no create affordance at all.** The only way to create a project task is the
   inline "Add task" row in the cockpit Tasks tab (`cockpit/tasks-section.tsx:99`), `isAdmin`-gated.
3. **`/tasks` silently 403s for every non-admin — the actual adoption blocker.**
   `app/(main)/(dashboard)/tasks/page.tsx` passes **no role**, and
   `project-board/components/views/tasks-view.tsx` contains **zero** `isAdmin` logic, so it renders
   six fully-interactive inline editors (Status, Assignee, Priority, Due, Est., Tags) for everyone.
   All six call `PATCH /api/v1/tasks/:id`, which is `requireAdmin` — `owner|admin` only
   (`api/v1/tasks/[id]/route.ts:53`, `lib/api/auth.ts:168`). A member clicks Status → red
   "Failed to update status" toast (`tasks-view.tsx:179-186`). The app looks broken.
4. **A project can't exist without a client.** `projects.account_id` is `NOT NULL`
   (`020_time_tracking.sql:42`) plus `required("account_id")` in the API — no internal projects
   (our own site, R&D, ops), which is most of what a person would self-start.
5. **Defaults bury your own work.** `/tasks` opens with all three Status chips *and* all four
   Priority chips lit — "everyone's tasks including Done". Empty states have no CTA. The two
   leftmost row icons (▶ start/stop timer, ⏱ log time, `tasks-view.tsx:405-451`) are unlabeled and
   go inert with no explanation when a task has no project.

**Outcome wanted:** any employee can open `/projects`, create a project (client *or* internal),
create tasks from `/tasks` or the cockpit, and update their own tasks without a 403 — while
budget/margin-bearing actions stay admin-only.

## Decisions already made by Sadin — do not relitigate

- **Client optional.** Name required; Account optional; a Client/Internal toggle drives whether the
  Account picker is required. Deal/proposal link stays optional and attachable later.
- **"Internal" adds no column** — derive it from `account_id IS NULL`. The toggle is pure UI.
- **Tasks always belong to a project** on this surface — the `/tasks` create dialog has a
  **required** Project picker and posts to the existing `POST /api/v1/projects/[id]/tasks`.
  No new endpoint. (`tasks.project_id` is already nullable from mig 032; we just don't offer
  project-less creation here.)
- **Permissions:** project creation stays `owner|admin` (it carries budget/rate/margin). **Task
  creation and own-task editing open to all tenant members** — that is what "let employees get
  started" requires. Positions/RBAC-driven delivery permissions are explicitly out of scope.

---

## Phase 1 — Creation paths

### 1a. Migration `supabase/migrations/224_projects_optional_account.sql`
```sql
ALTER TABLE projects ALTER COLUMN account_id DROP NOT NULL;
```
Exact precedent: `032_personal_tasks.sql:5` did this for `tasks.project_id`. Follow `_TEMPLATE.sql`
— transactional, idempotent, before/after counts, rollback line, self-records in
`schema_migrations`. 224 is the next free number (`223_admizz_ai_enabled.sql` is the tail).
**It rides the deploy pipeline. Do not hand-apply it to stage or prod.**

### 1b. `POST /api/v1/projects` — `src/app/(main)/api/v1/projects/route.ts:76`
- `account_id`: `[required("account_id"), isUUID()]` → `[isUUID()]` (optional).
- Accept and persist `owner_id` (isUUID, optional) and `start_date` / `target_end_date` (ISO date,
  optional). Columns already exist (migs 024, 128).
- Keep `requireAdmin`. Keep `scopedClient(auth)`.
- When `account_id` is supplied, do an explicit tenant-scoped existence check so a bad id returns
  400 rather than an FK error.
- **Then verify the null-account read path end to end**: `GET` enrichment in `route.ts:22-75`,
  `hooks/use-projects.ts`, `project-card.tsx`, `project-row.tsx`, `views/table-view.tsx`,
  `views/board-view.tsx`, the cockpit header. Each must render **"Internal"** rather than crash on
  `accounts: null`. This is the main regression risk of 1a.

### 1c. Promote and extend `ProjectForm`
```
git mv src/industries/it-agency/features/accounts/components/project-form.tsx \
       src/industries/it-agency/features/project-board/components/project-form.tsx
```
Promote, don't copy (per CLAUDE.md). Update the importers:
`accounts/components/account-detail/projects-tab.tsx` and `accounts/pages/account-detail.tsx:357`.

Keep the existing shadcn `Dialog` / `max-w-md` shape. Add:
- **Type toggle** Client / Internal. Client → Account picker shown and required. Internal → hidden,
  `account_id` omitted from the POST body.
- **Account combobox** (new — today `accountId` only arrives as a prop). Reuse the accounts list
  already loaded by `hooks/use-projects.ts`. When `accountId` is passed in from the accounts page,
  keep it locked exactly as today.
- **Owner picker** — reuse `project-board/components/owner-picker.tsx`.
- **Start / target end date** inputs.
- Existing Name / Status / Rate / Notes unchanged.

### 1d. `+ New Project` on `/projects`
- Primary `Button` with `<Plus/>` in `components/workspace-header.tsx`, top-right beside the
  Board/Table `Tabs` (`:138-152`). Render only for `owner|admin` — `role` is already threaded via
  `app/(main)/(dashboard)/projects/page.tsx` → `ProjectWorkspacePage({ tenantId, role })`.
- Opens `ProjectForm`; on success `router.push(`/projects/${project.id}`)` so the person lands in
  the cockpit, not back on the list.

### 1e. `+ New Task` on `/tasks` and in the cockpit
New `src/industries/it-agency/features/project-board/components/task-create-dialog.tsx` — shadcn
`Dialog` (the short-form convention used by Project/Account/Contact; **not** the `Sheet` convention
used by Deals/Proposals):
- **Project** combobox — **required**; reuse the project list `pages/tasks-workspace.tsx` already
  fetches. Submit must be blocked with no project selected.
- Title (required), Assignee (`components/assignee-picker.tsx`, defaults to **me**), Due date,
  Priority (options from `components/priority-pill.tsx`), Estimate in hours.
- `POST /api/v1/projects/{projectId}/tasks`, `estimated_minutes = Math.round(hours * 60)` — same
  body shape as `cockpit/tasks-section.tsx:51-59`.
- Trigger: `<Plus/> New task` in `components/tasks-workspace-header.tsx` beside the List/By-member
  `Tabs` (`:145-162`), visible to **all** members. The page has no refetch hook — insert
  optimistically, following the rollback-on-failure pattern in `tasks-view.tsx:224-235`.
- Add the same button to the cockpit Tasks tab header with the project pre-selected and locked.
  Keep the existing inline row form (it's faster) and unhide it for non-admins (2d).

### 1f. Empty states with CTAs
- `/projects`, zero projects → "No projects yet. Create your first project to start tracking
  delivery." + `New project` (admin) / "Ask an admin to create one" (member).
- `/projects`, zero **after filtering** → different copy: "No projects match these filters" +
  Clear filters. **No create CTA here.**
- `/tasks`, zero tasks → "No tasks yet. Create a task and attach it to a project." + `New task`.
- `/tasks`, zero after filtering → "No tasks match" + Clear filters.
- Cockpit Tasks tab, zero → "No tasks yet. Add the first task." + focus the inline form.

---

## Phase 2 — Stop the silent 403s (this is the phase that matters)

### 2a. `PATCH /api/v1/tasks/[id]` — own-vs-admin instead of blanket admin
Replace `if (!requireAdmin(auth)) return apiForbidden();` (`route.ts:53`). **Copy the shape this
repo already uses for time entries** — `canMutate()` in
`src/app/(main)/api/v1/time-entries/[id]/route.ts:32` (`if (requireAdmin(auth)) return true;` then
the ownership check). Do not invent a new pattern.
- Admin/owner → unchanged, full field set.
- Non-admin → allowed only when `assignee_id === auth.userId` **or**
  `assigned_by_id === auth.userId` (both columns exist; `assigned_by_id` from mig 110).
- Non-admin mutable fields: `status`, `due_date`, `estimated_minutes`, `tags`, `description`,
  `priority`. **Reject** an `assignee_id` change to anyone other than self; **reject**
  `is_billable`.
- `DELETE` stays `requireAdmin`.
- Keep `scopedClient(auth)`; the update keeps its caller-supplied `.eq("id", id)` filter.

Blast radius is two callers, both of which benefit:
`project-board/components/views/tasks-view.tsx:169` and
`time-tracking/components/task-row.tsx:78,106,124`.

### 2b. `POST /api/v1/projects/[id]/tasks` — open to members
Drop `requireAdmin` (`route.ts:63`). Keep `authenticateRequest` +
`getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)` + `scopedClient`. Stamp
`assigned_by_id = auth.userId` **server-side** (never from the body). Add a tenant-scoped project
existence check.

### 2c. Thread role into `/tasks`, render read-only where the user can't write
- `app/(main)/(dashboard)/tasks/page.tsx`: pass `role={tenantData.role}` (mirror
  `projects/page.tsx`) → `pages/tasks-workspace.tsx` → `views/tasks-view.tsx` and
  `views/members-view.tsx`.
- In `tasks-view.tsx`, for rows the user may not edit render **plain text / badges instead of the
  interactive control**. A control that renders and then errors is worse than no control. Rows the
  user *can* edit keep every control they have today.
- **Nothing else in this brief matters if a member still gets six red toasts.**

### 2d. Unhide the cockpit inline "Add task" for non-admins
`cockpit/tasks-section.tsx:99` and `:116`. Members can add and edit their own; keep admin-only for
`is_billable` and delete.

### 2e. Tests — `npm run test`
- `api/v1/tasks/[id]/route.test.ts` — admin full write; assignee patches own
  status/due/estimate/tags; non-assignee → 403; non-admin reassigning `assignee_id` to another user
  → 403; non-admin DELETE → 403.
- `api/v1/projects/route.test.ts` — create with no `account_id` succeeds; create with a
  foreign-tenant `account_id` fails; non-admin → 403.
- `api/v1/projects/[id]/tasks/route.test.ts` — member can create; `assigned_by_id` comes from the
  session, not the body.

---

## Phase 3 — Onboarding & intuitiveness

### 3a. `/tasks` defaults to *my open work*
In `hooks/use-workspace-filters.ts` / `components/tasks-workspace-header.tsx`:
- Default `assignee = me`; default Status chips = **To Do + In Progress** (Done off).
- Add an explicit **Mine / Everyone** segmented toggle. The current all-chips-lit state reads as
  "no filter applied", which is why nobody realizes they're looking at the whole company.
- Filters stay URL-encoded and shareable; **an explicit URL param must still win over the new
  default** so existing links don't change meaning.

### 3b. Label the mystery-meat row icons
`views/tasks-view.tsx:405-451` — `aria-label` + tooltip: "Start timer" / "Stop timer" (▶/■) and
"Log time" (⏱). When `task.projects == null` they're currently hidden or inert with no explanation:
render them **disabled with a tooltip** "Attach this task to a project to track time." Touch
targets ≥ 44×44px.

### 3c. Small clarity fixes
- `/projects` cards/rows and the cockpit header show **"Internal"** where the account name would be.
- Cockpit header gets the `+ New task` affordance from 1e.

### 3d. Docs — the living docs are stale, fix them here
Edit from a branch off the **latest `origin/stage`**, surgical `Edit`s not full rewrites
(`feedback_edit_docs_from_stage_copy`):
- `docs/FEATURE-CATALOG.md` — `project-board` row: drop "admin-only v1" and the "pending merge"
  language (git shows #160/#167/#168 merged long ago); record standalone create + member task
  editing.
- `docs/FEATURE-ROADMAP.md` — same "BUILT ON BRANCH / pending merge" staleness; close the
  `+ New Project` follow-up.
- `docs/STATUS-BOARD.md` — remove `+ New Project button` from the paused IT-agency surface-pass
  follow-ups.
- `docs/SESSION-LOG.md` — dated ship entry.
- `git mv` this brief to `docs/archive/features/` when the work ships.

---

## Out of scope this round — log to `FEATURE-ROADMAP.md`, don't build
Positions/RBAC-driven delivery permissions (today it's role-tier only, so "let this person do X"
means promoting them to admin — a genuine security-vs-usability trap deserving its own round);
sprints/cycles + burndown; task dependencies; portfolio health roll-up; engagement-typed project
templates; the timesheet *submission* half; AI-drafted status reports.

---

## Verification — required before you report done

**No hands-on DB work of any kind.** Mig 224 is a file that rides the pipeline.

1. **Local dev server, hands on** (`feedback_verify_local_dev_before_push`,
   `feedback_no_pr_without_local_verification`): `supabase start` → `./scripts/local-db-setup.sh` →
   apply 224 via the local runner → `npm run dev`. Log into the local `test-agency` (it_agency)
   tenant.
2. **As owner/admin:** create an **internal** project (no account) from `/projects` → lands on the
   cockpit, header reads "Internal", appears on Board + Table and in `GET /api/v1/projects`. Then
   create a **client** project with account, owner and dates. **Screenshot both.**
3. **As owner/admin:** create a task from `/tasks` (confirm submit is blocked with no project), then
   from the cockpit. Confirm it shows in both surfaces with the right project, assignee, estimate.
4. **As a non-admin member** — invite one through the app's own team UI, **not** raw SQL. Open
   `/tasks` and confirm: ① no red toasts anywhere, ② their own task's Status/Due/Est/Tags save,
   ③ someone else's task renders read-only rather than as a control that errors, ④ `+ New task`
   works, ⑤ ▶ and ⏱ have tooltips and a project-less task explains itself.
   **Screenshot this session — it is the acceptance criterion for the whole round.**
5. **Empty states:** with a filter matching nothing, confirm the "no match + clear filters" copy
   (not the create CTA) on both `/projects` and `/tasks`.
6. **Null-account regression sweep** — with an internal project present, load `/projects` board +
   table, the cockpit, `/accounts/[id]` Projects tab, `/time-tracking`, `/approvals`,
   `/resourcing`, `/resourcing/utilization`, and run the deal→project convert flow. This is the one
   change that can break unrelated screens.
7. `npm run test` green (including the new suites), `npm run build` clean,
   `npx eslint --max-warnings 50` clean (`feedback_run_ci_lint_before_merge`).

## Process non-negotiables
- Branch from the **latest `origin/stage`**; rebase onto it again right before merge.
- **Batch all of Phase 1–3 on one branch and push once** — a single PR to `stage`
  (`feedback_finish_features_end_to_end`). Do not merge each phase separately.
- **Stop at review.** Open the PR, report back, and wait. Do **not** self-merge (stage requires a
  second human's approval), do **not** promote to `main`, do **not** apply any migration by hand
  (`feedback_sonnet_oversteps_review_gate`).
- Report honestly: if a step was skipped or a check is red, say so with the output.

## Open item for Sadin (blocks nothing in Phases 1–3)
Delivery migs **128, 130–136** were stage-only per the last direct evidence in `docs/SESSION-LOG.md`
(2026-07-12). Several promotions have happened since, so they're probably on prod now — confirm via
`scripts/migrate-status.sh` or the `production-db` gate history **before the stage→main promotion**,
so 224 doesn't land on a prod schema missing its ancestors.

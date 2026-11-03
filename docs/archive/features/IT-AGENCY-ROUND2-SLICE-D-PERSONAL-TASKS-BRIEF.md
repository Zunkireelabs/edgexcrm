# Brief — it_agency Round 2 slice D: personal tasks are first-class (the Asana model)

**Author:** Opus (planner). **Executor:** Sonnet. **Date:** 2026-09-13.
**Branch:** `feature/it-agency-personal-tasks` off the latest `origin/stage`. **No migration.**
**Stop point:** PR open to `stage`, CI green, local-dev screenshots attached. Do not merge.

**HARD RULE:** no database access of any kind (CLAUDE.md top rule). Verify on local dev (`npm run dev` against the local Supabase stack) only.

**Code graph first:** orient with `graphify explain "<symbol>"` / `graphify path` before grepping. Never run `graphify update`.

---

## 1. The problem

Slice B's ⌘K quick-add creates a task with no project (`POST /api/v1/my-tasks` → `createTaskForUser`, `src/lib/tasks/create-task.ts:163` hard-codes `project_id: null`). `GET /api/v1/tasks` then excludes every such task (`src/app/(main)/api/v1/tasks/route.ts:82`, `.not("project_id", "is", null)`). A person creates a task on `/tasks` and it is not on `/tasks`.

## 2. The decision (made — do not reopen)

Model it on Asana: **a task does not need a project to be real.**

| Surface | Shows | Change? |
|---|---|---|
| **Home → My Work** | Every task **assigned to me**, with or without a project | **None.** `getMyTasks` (`src/lib/supabase/queries.ts`) already filters only by `assignee_id`. Verify only. |
| **`/tasks`** | Project tasks as today, **plus a "Personal" group** of project-less tasks | Yes — §3.1, §3.2 |
| **Delivery dashboard → My Tasks widget** | Everything assigned to me (it is literally "my tasks") | Yes — §3.3 |
| Task Progress, Who's Working on What, Overdue Tasks widgets, Members view | Project delivery only, as today | **No.** These are delivery metrics; personal to-dos would distort them. |

**Visibility of a project-less task in the `/tasks` list: only its assignee and the person who assigned it** (`assignee_id = me OR assigned_by_id = me`). This mirrors Asana's "tasks with no project are private to you and the people on them". It deliberately applies **to admins too** — at Zunkiree every member is an admin, so an admin-sees-all rule would put everyone's private to-dos in a shared table. RLS (mig 110) still allows admins; opening a task by URL (`/tasks/[id]`) is unchanged. This is a list-scoping choice, not a security boundary.

Who assigned to whom is already recorded correctly: `createTaskForUser` sets `assigned_by_id` only when the assignee is someone else (`create-task.ts:154`), so a self-created task is covered by `assignee_id = me`.

## 3. Changes

### 3.1 `GET /api/v1/tasks` — opt-in, default unchanged

In `src/app/(main)/api/v1/tasks/route.ts`:

- New query param `include_personal=1`. **Absent → behaviour byte-for-byte as today** (this is what protects the four widgets and Members view).
- When `include_personal=1` **and** neither `project_id` nor `account_id` is set, replace line 82 with:
  ```ts
  query = query.or(
    `project_id.not.is.null,assignee_id.eq.${auth.userId},assigned_by_id.eq.${auth.userId}`
  );
  ```
  `auth.userId` comes from the session (a UUID), never from the request — same safety argument as the `.or()` in `src/app/(main)/api/v1/leads/route.ts:113`. Confirm the scopedClient's auto `tenant_id` filter still ANDs with the `.or()` (add a test, §4).
- When `project_id` or `account_id` is set, ignore `include_personal` (those filters mean "project tasks").
- `shouldRestrictToSelf` keeps forcing `assignee_id = me`; it composes with the `.or()` correctly (AND), so nothing else is needed.
- Widen the select to `*, projects(id, name, account_id, accounts(id, name)), leads(id, first_name, last_name), deals(id, name)` so personal rows carry their lead/deal context.

### 3.2 `/tasks` table — a "Personal" group

In `src/industries/it-agency/features/project-board/components/views/tasks-view.tsx`:

- `buildQuery` sets `include_personal=1` when `filters.account === "__all__"`.
- Extract a pure helper (e.g. `splitTasksByProject(tasks)` → `{ projectTasks, personalTasks }`) next to the view and unit-test it.
- Render project tasks exactly as today, then a **"Personal · N"** group header row spanning all columns, then the personal rows. Collapsible, expanded by default. **Omit the group entirely when N = 0.** Column sort applies within each group; groups never interleave.
- Project cell for a personal row: reuse `deriveTaskContext` (`src/lib/home/task-context.ts`) — lead/deal chip if linked, otherwise muted text `Personal`. Do not build a second context-chip rule.
- Leave the timer button disabled with its existing tooltip. Timers on personal tasks are **Round 3**: `task_timers.project_id` (mig 135) and `time_entries.project_id` (mig 020) are `NOT NULL`, so it needs a migration and its own brief.
- Row click → existing `/tasks/[id]` drawer (slice A already handles project-less tasks).

### 3.3 Delivery dashboard My Tasks widget

`src/industries/it-agency/features/delivery-dashboard/widgets/my-tasks.tsx`: append `&include_personal=1`. Nothing else.

### 3.4 Docs

`docs/FEATURE-CATALOG.md`: update the project-board / tasks row to say personal tasks appear on `/tasks` (Personal group) and in My Tasks. Edit surgically from the stage copy — do not rewrite the file.

## 4. Tests

- **New `src/app/(main)/api/v1/tasks/route.test.ts`** (none exists for the list GET):
  1. Default request: the query excludes project-less tasks (same filter as today).
  2. `include_personal=1`: the `.or()` is applied with the caller's id — personal tasks I'm assigned to or assigned out are in; a third member's personal task is out.
  3. `include_personal=1&account_id=…` and `…&project_id=…`: personal ignored.
  4. Restricted-to-self caller with `include_personal=1`: still only own tasks.
  5. The tenant filter is still present alongside the `.or()`.
- Unit test for `splitTasksByProject` (empty, all-project, all-personal, mixed + sort stability).
- `npm run test`, `npx tsc --noEmit`, `npx eslint . --max-warnings 50`, `npm run build` all clean.

## 5. Local verification (screenshots required — green tests are not verification)

Three Zunkiree-like users on local dev: **A**, **B** (both admins), **C** (admin).

| # | Do | Expect |
|---|---|---|
| 1 | A: ⌘K on Home → "Buy domain", no project, self | On A's Home My Work **and** in A's `/tasks` Personal group |
| 2 | A: ⌘K → "Fix login copy", assign to B | B: Home My Work + `/tasks` Personal. A: `/tasks` Personal (as assigner). B gets the bell |
| 3 | C opens `/tasks` with assignee = All | Sees **neither** personal task; project tasks unchanged |
| 4 | A: choose an account filter | Personal group disappears |
| 5 | A: delivery dashboard | My Tasks widget includes "Buy domain"; Task Progress / Overdue counts identical to before the change |
| 6 | Personal task linked to a lead (create from lead detail) | `/tasks` Project cell shows the lead chip, not "Personal" |

Screenshots: rows 1, 2 (B's view), 3, 5.

## 6. Out of scope

Timers/time logging on personal tasks (Round 3, needs a migration) · multi-line paste → many tasks and create-task-from-inbox (next Round 2 brief) · Members view · any RLS change.

## Report back

Diff summary, test counts, the six-row table with pass/fail, screenshots, PR URL. Confirm not merged.

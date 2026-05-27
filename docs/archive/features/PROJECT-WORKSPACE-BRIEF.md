# Project Workspace — Design Brief

> The unified workspace for projects, tasks, and team work in the IT-agency CRM. Replaces the narrower "Project board" brief.
>
> Companion to the Opus planning session that produced this brief. Sonnet (executor) reads this file end-to-end before writing any code. Opus reviews Sonnet's output between phases.

**Started**: 2026-05-27
**Lead architect**: Sadin
**Planner (this doc)**: Opus
**Executor**: a separate Sonnet session
**Status**: Design approved; Phase 1 work parked on `feature/project-board-phase-1` (eeeb7e6) until reshape lands in Phase 1 of this brief

---

## Vision

The IT-agency tenant runs the whole engagement lifecycle in this CRM: leads → contacts → accounts → projects → tasks → time entries → billable totals. Today the **project and task layer is split across pages** — `/accounts/[id]` for the account's project list, `/time-tracking/projects/[id]` for one project's tasks + entries, `/time-tracking` for the timesheet, `/time-tracking/approvals` for sign-off. There's no single place to answer day-to-day questions like "what's in flight," "what's overdue," "who's overloaded," or "what's about to deliver."

**`/projects` becomes that single place.** A unified workspace with multiple views over the same underlying data, lifted shared filters at the top, and inline actions (log time, change status, reassign) without leaving the page. Mental model is Notion — different presentations of the same dataset, filters that follow you across views, fast read-flows for admins and quick task-update flows for members.

**Industry-scoped to `it_agency`.** Education tenants (Admizz) keep their existing flows untouched. Universal pages (leads, pipeline, team, settings) are unchanged.

---

## User stories (drive the design)

These are the flows the workspace MUST make easy. If a story isn't easy after a phase ships, that phase failed.

1. **"What's about to deliver?"** — Sadin opens `/projects`, sees the Board view, scans the "Review" column. One click per card → existing project detail page.
2. **"What's stalled?"** — Sadin filters Board view by status = `on_hold`. Sees the parking lot at a glance.
3. **"Show me everything for Acme."** — Sadin picks Account = Acme in the workspace filter; ALL views (Board, Table, Tasks) narrow to Acme's projects + tasks.
4. **"What's on Manish's plate today?"** — Sadin switches to Tasks view, filters Assignee = Manish, sorts by due_date, sees overdue + due-today in priority order.
5. **"Show me the team workload."** — Sadin switches to Members view, sees each team member with a count of open tasks + projects they own.
6. **"Log time for the task I'm working on."** — Manish opens Tasks view (filtered to himself by default), clicks "Log time" on a task row → `<LogTimeDialog>` opens pre-filled with the right task + project. Submit → entry appears in his timesheet.
7. **"This task is done — mark it."** — Manish or admin clicks the status pill on a Tasks-view row, picks "done", row updates inline; refetch happens automatically.
8. **"Reassign this task."** — Admin clicks the assignee chip on a Tasks-view row, picks a new member, optimistic update + PATCH.

Stories 1–3 ship in Phase 1. 4, 6, 7 land in Phase 3. 5, 8 ship in Phase 4/5.

---

## What's already built (parked on `feature/project-board-phase-1`)

Sonnet's commit `eeeb7e6` (394 insertions / 14 deletions, 17 files) on `feature/project-board-phase-1` shipped:

- ✅ Migration 023: extends `projects.status` CHECK with `in_review` + `delivered`; backfilled `done` → `delivered`.
- ✅ `FEATURES.PROJECT_BOARD` registered in `src/industries/_registry.ts`.
- ✅ `src/industries/it-agency/features/project-board/meta.ts` + manifest entry + sidebar entry (`LayoutGrid` icon, between Accounts and Time Tracking).
- ✅ `LayoutGrid` icon added to `INDUSTRY_ICONS` in `src/components/dashboard/shell.tsx`.
- ✅ Route shell at `src/app/(main)/(dashboard)/projects/page.tsx` (uses `getCurrentUserTenant()` — correct, brief's `authenticateRequest()` reference was wrong).
- ✅ Static kanban: `pages/board.tsx` + `components/project-board.tsx` + `project-column.tsx` + `project-card.tsx` + `board-filters.tsx` + `status-pill.tsx`.
- ✅ API tweaks: `PROJECT_STATUSES` arrays updated in `/api/v1/projects` and `/api/v1/projects/[id]`.
- ✅ ProjectForm + StatusBadge updated to drop `done` + add `in_review` + `delivered`.

**This work is HELD on the branch. Stage stays at `0aec70d` until the workspace shell ships.** Phase 1 below reshapes the parked work into the workspace; ~70% of files stay, ~30% reshape into the new layout.

---

## Information architecture

```
/projects  (workspace shell, route at src/app/(main)/(dashboard)/projects/page.tsx)
│
├── Header bar
│   │
│   ├── Search          ─ free text across project names + task titles
│   ├── Account filter  ─ FilterDropdown, "All accounts" default
│   ├── Owner filter    ─ FilterDropdown, "All owners" default
│   ├── Status filter   ─ multi-select chips (with "show cancelled" toggle)
│   ├── Sort dropdown   ─ context-dependent per view
│   └── (optional) "+ New project" button on right
│
├── View toggle  (Tabs primitive)
│   ├── Board       ← kanban by status (Phase 1 reshape of parked work)
│   ├── Table       ← sortable rows (Phase 1 new)
│   ├── Tasks       ← cross-project task list (Phase 3 new)
│   └── Members     ← group by owner/assignee (Phase 4 new)
│
└── View body  (whichever view is active, consuming the shared filters)
```

**URL encoding**: all filters + active view live in URL query params, e.g. `/projects?view=tasks&account=acme&assignee=manish&priority=high&due=overdue&q=launch`. Shareable. Bookmarkable. Reload-safe. Implemented with `useSearchParams` + `router.replace({ scroll: false })`.

**Permission model (v1):** workspace is **admin-only** (FEATURES.PROJECT_BOARD gate + admin role check on the page shell). Non-admin members get a 404 — they continue to use `/time-tracking` for their own work. Cross-cutting member self-view ("my plate today") is a follow-up brief.

---

## Data model changes

### Migration 024: `project_workspace_fields.sql`

One migration covers all schema changes. Applied via Supabase MCP.

```sql
-- ============================================================
-- 024: project workspace fields
-- Adds task assignment + categorization + ownership semantics
-- needed for the unified project workspace.
-- ============================================================

-- tasks: assignment + scheduling + categorization
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date    DATE,
  ADD COLUMN IF NOT EXISTS priority    TEXT NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('low','normal','high','urgent')),
  ADD COLUMN IF NOT EXISTS tags        TEXT[] NOT NULL DEFAULT '{}';

-- projects: owner (Client Services Lead — UI label flexible)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- accounts: owner (Account Manager — UI label flexible)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee
  ON tasks (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_due
  ON tasks (tenant_id, due_date) WHERE due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_priority
  ON tasks (tenant_id, priority);

CREATE INDEX IF NOT EXISTS idx_tasks_tags
  ON tasks USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_projects_tenant_owner
  ON projects (tenant_id, owner_id) WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_owner
  ON accounts (tenant_id, owner_id) WHERE owner_id IS NOT NULL;
```

**No RLS changes.** Existing policies on `tasks`/`projects`/`accounts` cover the new columns (member SELECT + admin mutate).

**Type updates** (`src/types/database.ts`):

```ts
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  // … existing fields …
  assignee_id: string | null;
  due_date: string | null;        // ISO date 'YYYY-MM-DD'
  priority: TaskPriority;
  tags: string[];
}

export interface Project {
  // … existing fields …
  owner_id: string | null;
}

export interface Account {
  // … existing fields …
  owner_id: string | null;
}
```

**Backfill**: none required. `owner_id` and `assignee_id` start NULL; `priority` defaults to `'normal'`; `tags` defaults to `'{}'`.

---

## API surface

### Reused as-is

| Route | Used by | Notes |
|---|---|---|
| `GET /api/v1/projects` | Board, Table | Already returns account join. Extend select to include `owner_id` + (joined team email for Owner column) in Phase 1; add `project_contacts(count)` in Phase 2. |
| `PATCH /api/v1/projects/[id]` | Board (drag P2), Table (inline P1) | Phase 1: accept `owner_id`. Phase 2: accept `expected_status` for TOCTOU 409. |
| `GET /api/v1/accounts` | Filters | Already returns the account roster; `owner_id` available after migration 024. |
| `PATCH /api/v1/accounts/[id]` | Account-detail edit | Phase 1: accept `owner_id`. |
| `GET /api/v1/team` | Owner/Assignee dropdowns | Already lists tenant_users with email + role + default_hourly_rate. |
| `GET /api/v1/time-entries/summary?dimension=project` | Card metrics (P2) | Already exists; one round-trip for all projects on board load. |
| `GET /api/v1/projects/[id]/tasks` | Project detail (unchanged) | Cross-project view uses the new route below. |
| `PATCH /api/v1/tasks/[id]` | Tasks view inline edits (P3) | Extend with `assignee_id`, `due_date`, `priority`, `tags`. |

### New routes

**`GET /api/v1/tasks`** (Phase 3) — cross-project task list, paginated, filterable.

```
Query params:
  project_id     UUID (single)
  assignee_id    UUID (single)
  status         comma-separated: todo,in_progress,done
  priority       comma-separated: low,normal,high,urgent
  tags           comma-separated (matches ANY)
  due            keyword: overdue | today | this_week | none | (omit for all)
  q              substring on title
  account_id     UUID (joins through project)
  page           int (default 1)
  page_size      int (default 50, max 200)

Returns:
  { tasks: [{ ...task, projects: { id, name, account_id, accounts: { id, name } } }],
    total: number,
    page, page_size }
```

**Industry gate**: `FEATURES.PROJECT_BOARD` (NOT `FEATURES.ACCOUNTS` — task routes have been on the accounts gate historically; tasks belong to the project workspace conceptually. New route uses PROJECT_BOARD gate; existing `/api/v1/tasks/[id]` and `/api/v1/projects/[id]/tasks` keep ACCOUNTS gate until a future cleanup sweep — not blocking).

**Counselor scoping**: when `auth.role === 'counselor'`, force `assignee_id = auth.userId` (server-side override, same pattern as leads). Defense in depth even though workspace is admin-only v1.

### Endpoints we deliberately did NOT add

- **`POST /api/v1/projects/[id]/members`** — no project_members junction in v1. Owner is a single column; team-membership ("who works on this") is implicit via assigned tasks + time entries.
- **`/api/v1/projects/board`** dedicated grouped endpoint — premature. Existing `GET /api/v1/projects` returns everything Board view needs in one call.

---

## UI architecture

### Files (final state after Phase 1 reshape)

```
src/industries/it-agency/features/project-board/
├── meta.ts                                    (unchanged from parked Phase 1)
├── pages/
│   └── workspace.tsx                          (replaces board.tsx; workspace shell entry)
├── components/
│   ├── workspace-header.tsx                   (NEW — lifted filters + view toggle)
│   ├── views/
│   │   ├── board-view.tsx                     (renamed from project-board.tsx)
│   │   ├── table-view.tsx                     (NEW — P1)
│   │   ├── tasks-view.tsx                     (P3)
│   │   └── members-view.tsx                   (P4)
│   ├── project-card.tsx                       (kept, used by board-view)
│   ├── project-column.tsx                     (kept, used by board-view)
│   ├── project-row.tsx                        (NEW — table row, also used in tasks-view's project column)
│   ├── task-row.tsx                           (P3 — shared task row in tasks-view + members-view)
│   ├── owner-picker.tsx                       (P1 — shared by table-view; uses /api/v1/team)
│   ├── assignee-picker.tsx                    (P3 — same shape as owner-picker but writes to tasks.assignee_id)
│   ├── status-pill.tsx                        (kept)
│   └── priority-pill.tsx                      (P3)
├── hooks/
│   ├── use-workspace-filters.ts               (NEW — URL state ↔ filter object; useSearchParams + router.replace)
│   └── use-projects.ts                        (NEW — fetcher with filters applied)
└── lib/
    └── due-keywords.ts                        (P3 — maps 'overdue'|'today'|'this_week'|'none' to date math)
```

**Deleted in Phase 1 reshape**: `board-filters.tsx` (lifted into workspace-header), `pages/board.tsx` (renamed to workspace.tsx with the view-toggle layer added).

### Component reuse from elsewhere in the codebase

- `<FilterDropdown>` from `src/components/ui/filter-dropdown.tsx` — exactly the pattern in the pipeline screenshot.
- `<Tabs>` + `<TabsList>` + `<TabsTrigger>` + `<TabsContent>` from `src/components/ui/tabs.tsx` — view toggle.
- `<Table>` + family from `src/components/ui/table.tsx` — Table view.
- `<DndContext>` from `@dnd-kit/core` — pattern reference is `src/components/pipeline/PipelineBoard.tsx`; **do not** import from there, build fresh under project-board/.
- `<LogTimeDialog>` from `src/industries/it-agency/features/time-tracking/components/log-time-dialog.tsx` — P3 task-row "Log time" button.

**`<LogTimeDialog>` extension in Phase 3**: accept optional `defaultTaskId` + `defaultProjectId` props, passed to `<TimeEntryAddForm>` to pre-select the task. One-prop addition; no API changes; existing project-detail caller continues to work without change.

---

## View specifications

### Board view (Phase 1 reshape — based on parked work)

- 5 columns visible by default: Discovery → In Progress → Review → Delivered → On Hold. Cancelled hidden unless "show cancelled" toggle is on (adds a 6th column, right-most).
- Column header: name + count.
- Project cards (Phase 1): name, account name, "Updated Nh ago", owner initials avatar (Phase 1 addition — show owner if set). Phase 2 adds: contact count, billable hours.
- Drag-and-drop column → column updates `projects.status` (Phase 2 only).
- Click card → existing `/time-tracking/projects/[id]`.

### Table view (Phase 1 new)

- Columns: **Project name · Account · Owner · Status · Updated · (Phase 2 adds: Contacts · Billable hrs)**.
- All columns sortable. Default sort: Updated desc.
- Inline edits (Phase 1): Status dropdown, Owner picker. Click title → detail page (do NOT inline-edit title in v1).
- Empty state: "No projects match these filters." with Clear-filters CTA.
- Pagination: client-side for v1 (project counts are small per tenant). Server-side pagination if >100 projects per tenant becomes common.

### Tasks view (Phase 3 new)

- Columns: **Task title · Project · Status · Assignee · Priority · Due · Tags**.
- Default sort: due_date asc (NULL last), then priority desc, then created desc.
- Inline edits: Status, Assignee, Priority, Due, Tags (chip add/remove).
- Action button per row: **Log time** → `<LogTimeDialog>` opens with task pre-selected.
- Counselor scope: server-side `assignee_id = auth.userId` enforced (defense in depth even though workspace is admin-only v1).
- Empty state: "No tasks match these filters." with Clear-filters CTA.

### Members view (Phase 4 new)

- One section per team member with at least one assigned task OR one owned project.
- Section header: avatar/initials + email + (count of owned projects) + (count of open tasks).
- Section body (collapsible, collapsed by default for inboxes with 0 open tasks):
  - Sub-header "Projects (owner)" with cards / rows of projects owned.
  - Sub-header "Tasks (open)" with rows of open tasks (status ≠ 'done'), sorted by due_date asc.
- Click member header → expand inline (no nav).
- Filtering: workspace filters apply (e.g. Account = Acme limits all member sections to Acme work).
- Sort: members sorted by total open-tasks desc, then by email asc.

---

## Filter specifications

All filters live in the workspace header; their state is URL-encoded via `useSearchParams`. A filter only renders if it makes sense for the active view.

| Filter | Type | Applies to view(s) | URL param | Default | Notes |
|---|---|---|---|---|---|
| Search | input | All | `q` | empty | Substring on project.name OR task.title (case-insensitive) |
| Account | single-select | All | `account` | `all` | Dropdown sourced from `/api/v1/accounts` |
| Owner | single-select | Board, Table | `owner` | `all` | Dropdown sourced from `/api/v1/team` |
| Status (project) | multi-select | Board, Table | `status` | (all visible) | Chips: discovery / in_progress / in_review / delivered / on_hold / cancelled |
| Assignee | single-select | Tasks, Members | `assignee` | `all` | Dropdown sourced from `/api/v1/team` |
| Status (task) | multi-select | Tasks | `task_status` | (all) | Chips: todo / in_progress / done |
| Priority | multi-select | Tasks, Members | `priority` | (all) | Chips: low / normal / high / urgent |
| Tags | multi-select | Tasks | `tags` | (none) | Sourced from distinct tags across tenant's tasks |
| Due | single-select | Tasks, Members | `due` | `all` | Keywords: overdue / today / this_week / none / all |
| Show cancelled | toggle | Board, Table | `cancelled=1` | off | Adds a 6th Cancelled column / shows cancelled rows |

**Sentinel pattern**: dropdowns use `"__all__"` as the "all" sentinel (Radix Select forbids empty `value`). The hook maps `__all__` → undefined when building the API query string.

---

## Phasing

Five phases. Each ships as one squashed commit on a fresh `feature/project-workspace-phase-{N}` branch.

### Phase 1: Workspace shell + Board + Table views (reshape parked work)

- **Migration 024** applied: tasks.assignee_id + due_date + priority + tags; projects.owner_id; accounts.owner_id; indexes. Type updates.
- **Workspace shell**: `pages/workspace.tsx` replaces `pages/board.tsx`. Renders header + tabs + view body. URL state via `use-workspace-filters` hook.
- **Lifted filters (P1 set)**: search, account, owner, status (multi-chip with show-cancelled toggle).
- **Board view**: cherry-pick the parked Phase 1 work. `pages/board.tsx` → `views/board-view.tsx`. Card adds owner initials. No drag-drop yet.
- **Table view (new)**: shadcn Table, sortable columns, inline Status dropdown, inline Owner picker. Default sort updated desc.
- **API extension**: `PATCH /api/v1/projects/[id]` accepts `owner_id`. `PATCH /api/v1/accounts/[id]` accepts `owner_id`. `GET /api/v1/projects` select includes `owner_id` + joined team email/role for Owner column.
- **Permission**: admin-only on the page shell (non-admins 404). Industry gate unchanged.
- **Branch hygiene**: after Phase 1 squash-merges to stage, delete `feature/project-board-phase-1` from origin (its work is superseded — rendering preserved, file layout changed).
- **Verify**: as Zunkireelabs admin, `/projects` renders the workspace shell, both views work, filters narrow both, URL reflects state, reload preserves state. As Admizz admin or Zunkireelabs counselor, `/projects` 404s.

### Phase 2: Drag-drop on Board + card metrics

- **TOCTOU PATCH extension**: `expected_status` optional field on `PATCH /api/v1/projects/[id]`; mismatch → 409 INVALID_STATE with current status echoed.
- **Drag-drop**: `<DndContext>` wraps Board columns. Optimistic move on drag end → PATCH with `expected_status` → revert + toast + refetch on 409, revert + toast on other error.
- **Card metrics**: extend `GET /api/v1/projects` select with `project_contacts(count)` PostgREST embed; one separate call to `/api/v1/time-entries/summary?dimension=project` for billable hours; render `{contact_count} contacts` and `{hours.toFixed(1)} billable hrs` on cards.
- **Verify**: drag persists across reload; two-window race returns 409 + toast; cards show metrics matching the project-detail page; on_hold column visible and muted.

### Phase 3: Tasks view + log-time-from-row

- **New endpoint `GET /api/v1/tasks`** (cross-project, filterable, paginated, gated on PROJECT_BOARD, counselor-scoped).
- **Tasks view**: shadcn Table with columns per spec; inline edits via `PATCH /api/v1/tasks/[id]` (extend to accept assignee_id, due_date, priority, tags).
- **`<AssigneePicker>`** component sourced from `/api/v1/team`.
- **`<PriorityPill>`** + dropdown picker.
- **`<LogTimeDialog>` extension**: accept `defaultTaskId` + `defaultProjectId` props.
- **Task row "Log time" button**: opens dialog pre-selected; on success, refetch tasks (no need to refetch board/table since billable hours don't propagate until approval).
- **Due-keyword mapping**: `lib/due-keywords.ts` exports `dueFilterToDateRange(keyword)` returning `{ from, to } | null`.
- **Verify**: filters narrow tasks; sort works on all columns; inline status/assignee/priority/due/tags all persist after reload; "Log time" opens pre-filled; tag-add via chip input works.

### Phase 4: Members view + member sectioning

- **Members view**: batched queries — `/api/v1/team` for member list + `/api/v1/projects?owner_id=…` aggregated per member + `/api/v1/tasks?assignee_id=…` per member. Plan: one call to team, one call to projects with `owner_id IN (…)` if backend supports it, otherwise loop with a small concurrency cap. Cache aggressively in client; refetch on filter change.
- **Member sections**: collapsible (closed by default for empty inboxes), counts in header.
- **Workspace Owner filter extends behavior to Members view**: narrows the section list.
- **Verify**: section counts match DB queries; clicking a project name navigates to detail; section sort holds (busiest first); collapse/expand state holds across renders.

### Phase 5: Polish + shareable URLs + empty-state UX

- **URL state hardening**: every filter + view + sort writes through `router.replace({ scroll: false })`; deep links reproduce state exactly.
- **Empty states**: per-view, per-filter-combo. "No projects match" → CTA "Clear filters" with one-click reset.
- **Keyboard shortcuts**: `b`/`t`/`k`/`m` to switch views; `/` focuses search; `Esc` clears search.
- **Accessibility audit**: tab order, ARIA labels on pickers and column sort buttons, screen-reader narration of optimistic updates.
- **Optional polish**: "Today" smart filter (preset: assignee=self, due=today_or_overdue, status≠done — useful for admins who also have assigned tasks).
- **Verify**: keyboard-only navigation passes user stories; URL deep-links round-trip; lighthouse a11y score ≥ 95.

---

## Per-phase verification matrix

Sonnet runs each row before reporting back. Failures get fixed before the next phase starts. **All phases must pass `npm run build` clean.**

### Phase 1

- [ ] Migration 024 applied. `SELECT column_name FROM information_schema.columns WHERE table_name = 'tasks' AND column_name IN ('assignee_id', 'due_date', 'priority', 'tags')` returns 4 rows. Same check for projects/accounts owner_id.
- [ ] As Zunkireelabs admin: `/projects` renders header + tabs (Board / Table); both views render the same set of projects; filters narrow both; URL reflects filter state; reload preserves; switch view → URL updates; account dropdown populated; owner dropdown populated.
- [ ] Table view: click a column header → re-sorts; click again → reverses; inline Status dropdown persists; inline Owner picker persists.
- [ ] Board view: cards show owner initials if owner_id is set; clicking card → `/time-tracking/projects/[id]`.
- [ ] As Admizz admin: `/projects` 404. Sidebar item absent.
- [ ] As Zunkireelabs counselor: `/projects` 404. Sidebar item absent.
- [ ] `PATCH /api/v1/projects/[id]` with `owner_id` persists; same for accounts.
- [ ] After Phase 1 ships to stage, `feature/project-board-phase-1` branch deleted from origin.

### Phase 2

- [ ] All Phase 1 checks still pass.
- [ ] Drag a project from Board's In Progress → Review → reload → stays in Review.
- [ ] Two browsers same project: drag in tab 1 succeeds; drag in tab 2 (stale) → 409 toast + auto-refetch + card shows new state.
- [ ] PATCH without `expected_status` still updates (back-compat preserved).
- [ ] Card metrics on Board match what `/time-tracking/projects/[id]` shows in billable totals.
- [ ] Cancelled column hidden by default; show-cancelled toggle reveals it.

### Phase 3

- [ ] All Phase 2 checks pass.
- [ ] `GET /api/v1/tasks?assignee_id=X&status=todo,in_progress&priority=high,urgent&due=overdue` returns the correct subset.
- [ ] Tasks view: sort by every column works.
- [ ] Inline edits persist for all editable fields (status, assignee, priority, due, tags).
- [ ] "Log time" button opens dialog with task + project pre-selected; submitting creates a time entry visible on `/time-tracking`.
- [ ] Tags: adding a new tag via chip input persists; removing also persists.

### Phase 4

- [ ] All Phase 3 checks pass.
- [ ] Members view: every team member with ≥1 owned project OR ≥1 assigned open task appears.
- [ ] Section counts match the actual data (`SELECT COUNT(*) FROM projects WHERE owner_id = X` and `SELECT COUNT(*) FROM tasks WHERE assignee_id = X AND status <> 'done'`).
- [ ] Workspace Owner filter narrows the section list.
- [ ] Collapsed/expanded state holds during renders.

### Phase 5

- [ ] All Phase 4 checks pass.
- [ ] Keyboard shortcuts work as specified.
- [ ] Lighthouse a11y score ≥ 95.
- [ ] All empty states render with helpful copy + Clear-filters CTA.
- [ ] Deep link `/projects?view=members&account=acme&priority=high&assignee=manish` reproduces exact state on cold load.

---

## Non-goals (v1)

- **Member self-view** ("my plate today" for non-admins). Workspace is admin-only v1; follow-up brief later.
- **Department / team grouping**. Sadin flagged this as a "later" feature. No schema for departments in v1.
- **Configurable per-tenant project pipelines**. Stage enum is the source of truth; ship configurable pipelines when a 2nd IT-agency tenant needs different stages.
- **Saved user views** (Notion-style "Views"). URL-encoded shareable filters are enough for v1.
- **Realtime updates**. Stale-on-refresh accepted.
- **Calendar view** of tasks by due_date. Tasks view with due sort covers the need.
- **Project templates** ("create from template").
- **Activity feed per project** in the workspace. Already on the project detail page.
- **Mobile-first layout**. Desktop-only v1.
- **Drag-drop kanban for tasks**. Inline status dropdown covers the need.
- **Bulk multi-select** on Table/Tasks. Polish phase later.
- **`project_members` junction table**. Owner is single-column; team membership is implicit via assigned tasks + time entries. Add the junction when a real "team-on-a-project" use-case arises.

---

## Open questions

- **Phase 1 includes a Table view, which is fresh code Sonnet hasn't built.** Bundling it because the workspace shell is the harder lift; adding Table on top while the shell is fresh is cheap. If you'd rather split P1 into P1a (reshape + Board only) and P1b (Table), flag before kickoff.
- **Owner UI label**: "Owner" is the most generic word and survives the future "Client Services Lead" / "Account Manager" relabel without schema changes. If you want a specific label in v1, say so.
- **Counselor reaches the workspace?** Decision is admin-only v1. If counselors need a "my plate today" surface before v2, the workaround is `/time-tracking` (their existing timesheet).

---

## Code-review checklist (applied each phase, on top of the 6 standing items)

The 6 standing items in STATUS-BOARD § "Code-review checklist additions" apply throughout. Additionally per-phase:

- **Phase 1**: Migration 024 must include all 6 columns + 6 indexes in ONE file. Type updates must not break existing project/account/task consumers (grep for current consumers + verify TypeScript clean).
- **Phase 2**: `expected_status` precondition must mirror the time-entries `.eq("approval_status", "pending")` pattern. The 409 response shape must match the existing INVALID_STATE shape exactly (`code: "INVALID_STATE"`, `message: "..."`).
- **Phase 3**: New `GET /api/v1/tasks` route must use `scopedClient(auth)`, counselor-scope override (`assignee_id = auth.userId`), and `FEATURES.PROJECT_BOARD` gate (NOT `FEATURES.ACCOUNTS` — flagged explicitly).
- **Phase 3**: `<LogTimeDialog>` extension is a *prop addition*, not a behavior change. Existing callers (project-detail page) must continue to work without change.
- **Phase 4**: Members view aggregation must not N+1. Either batch with `IN (?, ?, ?, ...)` for project lookups or accept a single query that joins; benchmark before shipping if member count > 20.
- **Phase 5**: All `router.replace` calls must use `{ scroll: false }` — page scroll must not jump on filter change.

---

## Workflow reminders

- **Opus plans + reviews + pushes to stage + writes docs.** This brief is the contract.
- **Sonnet writes ALL code on `feature/project-workspace-phase-{N}` branches**, including small fixbacks Opus catches in review.
- **Local-verify-before-push.** Sonnet runs `npm run build` + the per-phase verification matrix before reporting back.
- **Per-phase squash merge.** Opus reviews diff, runs independent smoke, squashes Sonnet's branch into a single commit on stage, deletes the branch.
- **Production promotion** happens after all 5 phases ship + an observation window. Stage→main is Opus's call, gated on Sadin's go-ahead.
- **Phase 1 supersedes `feature/project-board-phase-1`**: after Phase 1 of this brief squash-merges to stage, delete the parked branch from origin. Its rendering content is preserved; the file layout changes.

---

## Glossary

- **Workspace** — the unified page at `/projects` with view toggle + lifted filters.
- **View** — one of Board / Table / Tasks / Members; presents the same dataset in a different shape.
- **Filter** — top-level state (URL-encoded) that narrows what each view shows. Lifted = applies across all views; per-view = only renders/affects in views where it makes sense.
- **Owner** — `projects.owner_id` / `accounts.owner_id`. UI label is "Owner" v1; relabels to "Client Services Lead" / "Account Manager" later via copy without schema change.
- **Assignee** — `tasks.assignee_id`. The single person responsible for this task.
- **Status (project)** — the kanban-column field. Values: `planning | active | in_review | delivered | on_hold | cancelled`. UI labels: Discovery / In Progress / Review / Delivered / On Hold / Cancelled.
- **Status (task)** — `todo | in_progress | done`. Unchanged from existing schema.
- **Priority (task)** — `low | normal | high | urgent`. New in migration 024.
- **TOCTOU** — time-of-check vs time-of-use. Race condition on drag-drop; solved by `.eq("status", expected_status)` precondition.

# BRIEF — "My Work": finish the personal work surface on Home

**Author:** Opus (planner) · **Executor:** Sonnet · **Date:** 2026-09-07
**Tenants:** universal (all industries) + `it_agency` extras · **Base branch:** latest `origin/stage`
**Migrations:** **none.** No DB work of any kind in this round.

---

## Why

This is Phase 4 of the it_agency delivery rework (the "My Work employee home" phase deferred when
the 2026-09-05 self-serve round shipped Phases 1–3 as PR #500).

**It is not greenfield.** Home already exists at `/home` with an Overview / Schedule / Tasks /
Activities tab set, a day-at-a-glance rail, and an it_agency block already titled **"My Work"**
(`home-content.tsx:151-159`) holding the MyUtilization + MyTime widgets. Manjila's #493 refresh
built that. The Tasks tab already groups by Overdue / Due today / Due tomorrow / Later with
All / Overdue / Completed chips. **Do not rebuild any of that.**

### The data model (read this before touching anything)

There is **one `tasks` table**, and its history is why the surfaces feel inconsistent:

| Migration | What it did |
|---|---|
| `020_time_tracking.sql:76` | Born as an it_agency **project** task. `project_id NOT NULL`. |
| `032_personal_tasks.sql` | `project_id` made nullable → personal to-dos. |
| `110_task_assignment.sql` | Added `assigned_by_id`, `lead_id`, `deal_id` → **universal** task assignment. |

A task row carries *optional links*: `project_id` (delivery work), `lead_id` (CRM follow-up),
`deal_id`, or none (personal to-do). These are **not different types** — one row, different
attachments.

The two surfaces differ **only by query filter**:

- **Home → Tasks** (universal, every industry): `getMyTasks` (`queries.ts:945`) = every task where
  `assignee_id = me`. No project filter.
- **`/tasks`** (it_agency only, `PROJECT_BOARD`-gated): `GET /api/v1/tasks` hard-filters
  **`.not("project_id", "is", null)`** (`route.ts:82`). Project tasks only, any assignee.

They overlap on exactly one set — **my project tasks** — and that overlap is what's broken.

### Verified findings

1. **Home renders my project tasks as context-less to-dos.** `getMyTasks` already selects
   `projects(id, name)` and `PersonalTask` already types it (`queries.ts:912`) — and **no Home
   component reads it.** `tasks-tab-content.tsx` contains zero project references. A task on a
   client project looks identical to "buy milk": no project name, no cockpit link, no timer.
   Lead links do render, but as bare blue text (`tasks-tab-content.tsx:59-61, 84-88`), and deals
   don't render at all despite `PersonalTask.deals` being populated.
2. **Home's "today" is the browser's, not the tenant's.** `toLocalDateString(new Date())` at
   `tasks-tab-content.tsx:180`, `tasks-card.tsx:30`, `home-content.tsx:120`. The API side is
   already correct — `/api/v1/tasks:98` uses `todayInTz(tenant.timezone)`, and `due-keywords.ts`
   does pure calendar-string math (both fixed by #197). So Home is the **only** remaining
   disagreement: a task can read "Overdue" on Home and "Due today" on `/tasks`.
3. **The rail hides the number that matters.** `day-glance-rail.tsx` STATS_CONFIG shows
   meetings / tasks-due-today / activities / unread. In Sadin's 2026-09-07 screenshot it reads
   "Tasks due today **0**" while three tasks sit overdue directly below — and the Reminder card
   *does* say "You have 3 overdue tasks". Overdue is missing from the one place designed to be
   glanced at.
4. **Running timers are invisible outside `/time-tracking`.** `RunningTimersPanel` is mounted in
   exactly one place — `time-tracking/pages/timesheet.tsx:218`. A timer can run all night with
   nothing anywhere saying so. `GET /api/v1/timers` is already own-scoped and correct
   (`route.ts:32-44`).
5. **Home gates delivery UI on a raw `isItAgency` boolean** (`home-content.tsx:49, 151`), which is
   the wrong gate per CLAUDE.md. `home/page.tsx` already calls `getFeatureAccess` twice (outreach,
   application-tracking) — the delivery block should ride the same truth function.
6. **Two task-row renderers already exist**: shared `components/dashboard/tasks/task-row.tsx` (used
   by `tasks-card.tsx:7`) and a private `TaskRow` inside `tasks-tab-content.tsx:42`. Any row change
   must land in both or the two Home surfaces drift further apart.

**No permissions work is needed.** `PATCH /api/v1/my-tasks/[id]` already allows assignee-or-assigner
(`route.ts:88`), so members editing their own project tasks from Home will not hit the 403 family
that broke `/tasks` before #500.

---

## Decisions already made by Sadin — do not relitigate

- **Extend Home. No new route, no new nav item.** Home is the canonical personal surface.
- **The task spine is universal; work-context decorations are feature-gated.** Context chips,
  tenant-tz dates and overdue counts ship to **every** industry (Admizz counsellors have tasks
  too). Timers, utilization and billable time stay gated.
- **Gate on `getFeatureAccess`, never on a hardcoded industry string.** So the day travel_agency
  opts into projects, Home is already correct.
- **The running-timer chip is global** — in the dashboard shell header, visible on every page, not
  only on Home. Half-measures don't solve "timer left running unnoticed".
- **Zero requests for tenants without time-tracking.** Non-negotiable, see Phase 3.
- **Phase 4 plants the IA rule but does not do the IA cleanup** (that's Phase 5). Nothing is
  removed this round.

---

## Phase 1 — Universal: context, correct dates, overdue

### 1a. One "today", and it's the tenant's

`home/page.tsx` already has `tenant` in scope. Compute once:

```ts
import { todayInTz } from "@/lib/hr/dates";
const todayISO = todayInTz(tenant.timezone ?? "Asia/Kathmandu");
```

Pass `todayISO` to `HomeContent` → `TasksCard` / `TasksTabContent` / the rail count. Replace every
`toLocalDateString(new Date())` on the Home task path: `tasks-tab-content.tsx:180`,
`tasks-card.tsx:30`, `home-content.tsx:120`.

**Delete the local `addDays` helper at `tasks-tab-content.tsx:31-35`** — it round-trips through a
`Date` and reintroduces exactly the bug #197 removed. Use `addDays` from `@/lib/hr/dates:31`, which
is pure ISO-string math.

Leave `toLocalDateString` itself alone — it has other callers. This is about the Home task path only.

### 1b. Task context chip — one renderer, used by both rows

New `src/components/dashboard/tasks/task-context-chip.tsx`. Derivation precedence, first match wins:

| Link present | Chip | Href |
|---|---|---|
| `projects` | project name | `/projects/{project_id}` — **only when `projectBoardEnabled`**, else render plain text |
| `deals` | deal name | `/deals/{deal_id}` |
| `leads` | first+last name | `/leads/{lead_id}` |
| none | *(render nothing)* | — |

A chip that links somewhere the tenant 404s is worse than no chip — that is the #500 lesson
restated. `PersonalTask` already carries all three relations (`queries.ts:910-912`), so **no query
change and no API change**.

Use the chip from **both** row renderers (finding 6). In `tasks-tab-content.tsx`, the chip
**replaces** the ad-hoc blue lead-name link at `:84-88` — do not leave two mechanisms rendering the
same idea.

### 1c. Overdue on the rail, and make it click through

- Add an `overdue` stat to `STATS_CONFIG` in `day-glance-rail.tsx`. Count = open tasks with
  `due_date < todayISO`. Give it the same visual weight as the others; when it is > 0 it may carry
  a muted warning tone, but **do not** make it a red alarm — three overdue follow-ups is a normal
  Monday, not an incident.
- Clicking it opens the Tasks tab **with the Overdue filter already applied**. The filter is
  currently local state inside `tasks-tab-content.tsx:174`; lift it to `home-content.tsx` and
  thread it down, the same way `activeTab` already is (`home-content.tsx:82`). Keep the existing
  chips working exactly as they do now.

---

## Phase 2 — it_agency: delivery affordances on my project tasks

### 2a. Replace the `isItAgency` gate with feature access

In `home/page.tsx`, alongside the two existing `getFeatureAccess` calls:

```ts
const projectBoardEnabled = getFeatureAccess(tenant.industry_id, FEATURES.PROJECT_BOARD);
const timeTrackingEnabled = getFeatureAccess(tenant.industry_id, FEATURES.TIME_TRACKING);
```

Pass both to `HomeContent`. **Remove the `isItAgency` prop** (`home-content.tsx:49, 73`) and gate
the existing MyUtilization/MyTime block (`:151`) on `timeTrackingEnabled` instead. Behaviour today
is identical (it_agency is the only industry with these features) — this is a correctness change,
not a behaviour change, and it must stay behaviour-neutral. Say so in the PR.

### 2b. Start/stop timer on my project task rows

When `timeTrackingEnabled` **and** the task has a non-null `project_id`, render a start/stop control
on the task row. Reuse the existing endpoints — `POST /api/v1/timers` (body `{ task_id }`) and
`POST /api/v1/timers/{id}/stop`. No new API.

**Render it only for project tasks.** `POST /api/v1/timers` returns `422 NO_PROJECT` for a
project-less task (`timers/route.ts:80`); a control that exists and then errors is the exact defect
#500 was opened to fix. For a personal or lead task, render nothing — not a disabled button.

Label it (`aria-label` + tooltip): "Start timer" / "Stop timer". Touch target ≥ 44×44px.

---

## Phase 3 — Global running-timer chip (keep this a separable commit)

This is the highest-value and highest-risk item in the round. **Commit it on its own** so it can be
reverted alone without unpicking Phases 1–2.

### 3a. The gate — this is the acceptance criterion

Add `timeTrackingEnabled?: boolean` to `DashboardShellProps` (`shell.tsx:279`). Compute it in
`(dashboard)/layout.tsx` next to the existing `hasLeadLists` line (`layout.tsx:42`):

```ts
const timeTrackingEnabled = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING);
```

**When false the component must not mount at all** — mirror the `aiAssistantEnabled &&` pattern at
`shell.tsx:1081`, whose comment says exactly this ("hidden entirely, not just its requests 404").
Admizz must make **zero** additional requests per navigation. Platform-wide speed is a standing
priority; a per-navigation round-trip for a 16k-lead tenant to render a feature it doesn't have is
not acceptable and will be checked in review with the network tab.

### 3b. The component

New `src/components/dashboard/running-timer-chip.tsx`, mounted in the shell header's right cluster —
before `<BranchSwitcher/>` at `shell.tsx:1095`.

- **Data:** `GET /api/v1/timers`, already own-scoped (`route.ts:38-44`). Fetch **once on mount**.
- **Elapsed time is computed client-side** from `started_at` with a 1s `setInterval`. Do **not**
  poll the API every second. Re-fetch only on window `focus` and immediately after a start/stop.
- **Multiple timers are possible** — the endpoint returns an array ordered by `started_at`
  ascending. Show the oldest plus a count; never assume exactly one.
- Nothing running → render nothing. No empty chip, no zeroed clock.
- Clicking the chip's stop button → `POST /api/v1/timers/{id}/stop`, then refetch. Clicking the body
  navigates to `/time-tracking`.
- Clean up the interval on unmount.

### 3c. Conflict discipline

`shell.tsx` is CLAUDE.md's #1 merge-conflict file. Rebase onto the latest `origin/stage` immediately
before merge and resolve **hunk-by-hunk** — never "keep my whole file". `shell.nav.test.ts` exists;
keep it green.

---

## Phase 4 — Docs, and plant the IA rule

Edit from a branch off the **latest `origin/stage`**, surgical `Edit`s not rewrites
(`feedback_edit_docs_from_stage_copy`).

### 4a. The canonical rule (new — this is the durable output of the round)

Write into `docs/FEATURE-CATALOG.md`, on the tasks/home row:

> **Task surface rule.** `tasks` is one universal table; links (`project_id` / `lead_id` /
> `deal_id`) are optional context, not types.
> **Home → Tasks** is the canonical *"everything assigned to me, any context"* surface — universal,
> every industry.
> **`/tasks`** is the canonical *"project work, any assignee"* surface — it_agency, `project_id IS
> NOT NULL`.
> Every other task view (Home Overview's TasksCard, the cockpit Tasks section, the shell timer chip)
> is a **summary that links into one of those two** and must not grow into a third destination.

Phase 5's IA pass inherits this as a stake in the ground rather than an open debate.

### 4b. Correct two stale roadmap lines

`docs/FEATURE-ROADMAP.md` **P1 and P2 are both already fixed** and are misleading anyone who reads
the backlog:

- **P2** (line 46) — "due-date keyword filters off-by-one" describes a `toISODate` function that no
  longer exists. Fixed by `b6901f84` (#197, 2026-07-13); `due-keywords.ts` now takes `todayISO` from
  the caller and does pure calendar-string math.
- **P1** (line 45) — "money formatting hardcoded USD" was fixed in the same PR, backed by
  `153_tenant_default_currency.sql`.

Delete both, or mark them shipped with the PR reference. Don't leave fixed bugs in a live backlog.

### 4c. The rest

- `docs/FEATURE-CATALOG.md` — Home row: tenant-tz dates, context chips, overdue rail stat, global
  timer chip with its feature gate.
- `docs/FEATURE-ROADMAP.md` — move Phase 4 to shipped; note that Phases 5 (Delivery nav/IA) and 6
  (cockpit redesign) remain open.
- `docs/SESSION-LOG.md` — dated ship entry.
- `git mv docs/HOME-MY-WORK-BRIEF.md docs/archive/features/` when the work ships.

---

## Out of scope this round — log, don't build

Phase 5's Delivery nav / IA pass; Phase 6's cockpit redesign; removing or merging any existing task
surface; task dependencies; sprints; changing what `/tasks` queries; any migration; any change to
`getMyTasks`'s query shape (everything needed is already selected).

---

## Tests — `npm run test`

- **Grouping under a foreign timezone.** The dev Mac is `Asia/Katmandu`, which is also the
  `tenants.timezone` default — so a tz bug passes locally and only breaks on the UTC container
  (`feedback_date_tests_need_foreign_timezone`). Test the grouping helper with a tenant tz that is
  **not** the process tz, in both directions (a UTC− zone like `America/New_York` and a UTC+ zone),
  and assert a task due "today" in tenant-tz is never grouped Overdue.
- **Context-chip precedence** — project beats deal beats lead; project chip renders as plain text
  (no href) when `projectBoardEnabled` is false; nothing renders when all three links are null.
- **Shell gate** — `timeTrackingEnabled={false}` ⇒ the chip component is not rendered *and* no
  `/api/v1/timers` fetch is issued.
- **Timer chip** — multiple running timers show the oldest plus a count; zero timers render nothing;
  the interval is cleared on unmount.
- Keep `shell.nav.test.ts` green.

---

## Verification — required before you report done

**No DB access of any kind.** There is no migration in this round.

1. **Local dev, hands on** (`feedback_verify_local_dev_before_push`,
   `feedback_no_pr_without_local_verification`): `supabase start` → `./scripts/local-db-setup.sh` →
   `npm run dev`.
2. **As an it_agency user** (local `test-agency`): assign yourself one project task, one lead task
   and one personal task. On Home → Tasks confirm each shows the right chip, the project chip opens
   the cockpit, and only the project task offers a timer. **Screenshot.**
3. **Start a timer, then navigate to `/leads`, `/pipeline` and `/settings`.** The chip must be
   visible on all of them, ticking, and stopping from the chip must land a time entry visible on
   `/time-tracking`. **Screenshot at least two different pages.**
4. **As an education user** (local `admizz-local`): Home → Tasks shows lead chips and correct
   grouping, **no** timer controls, **no** utilization/time widgets, and — with the browser Network
   tab open across three navigations — **zero requests to `/api/v1/timers`. Screenshot the network
   tab.** This is the acceptance criterion for Phase 3.
5. **Timezone proof:** set the local tenant's timezone to something far from the machine's
   (e.g. `America/Los_Angeles`) via the app's own settings UI — **not SQL** — and confirm a task due
   on the tenant's "today" is grouped Due today on Home and by `/tasks`' own filter identically.
6. **Rail:** overdue count matches the Overdue group's count exactly, and clicking it opens the
   Tasks tab with the Overdue filter applied.
7. `npm run test` green, `npm run build` clean, **`npm run lint`** clean
   (`npm run lint`, not `npx eslint` — `feedback_run_ci_lint_before_merge`).

---

## Process non-negotiables

- Branch from the **latest `origin/stage`**; rebase onto it again right before merge.
- **Batch Phases 1–4 on one branch and push once** — a single PR to `stage`
  (`feedback_finish_features_end_to_end`). Keep Phase 3 as its **own commit** within that branch.
- **Stop at review.** Open the PR, report back, and wait. Do **not** self-merge (stage requires a
  second human's approval from `ani-shh`), do **not** promote to `main`
  (`feedback_sonnet_oversteps_review_gate`).
- Report honestly: if a step was skipped or a check is red, say so with the output. Screenshots are
  the deliverable for steps 2–5, not a description of what you saw.

## Note for the reviewer

There are 5 commits already sitting on `stage` awaiting promotion (blast hardening + docs), held for
Hardik's F3/F4. This round adds to that batch — it does not change the promotion plan, and it
carries **no migration**, so the next promotion stays a plain code deploy with no `production-db`
gate.

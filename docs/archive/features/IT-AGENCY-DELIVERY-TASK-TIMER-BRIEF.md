# IT-Agency Delivery — Task Start/Stop Timer (BUILD BRIEF)

**For:** Sonnet executor session · **Branch:** `feature/it-agency-delivery-tier0` (stack on it — do NOT branch off stage) · **Industry:** `it_agency` (scoped) · **Migration:** **135** (local-only) · **Stop at review** — build uncommitted, Opus verifies + commits.

**Reviewed + scoped by Opus with Sadin.** Adds a start/stop timer on a task. Hit Start when you begin, Stop when you're done; the server computes elapsed and writes a **normal `time_entries` row** tagged `source='timer'`. It's born `pending`, so it flows through the exact same timesheet → approvals → billing/cost/margin → reconcile pipeline as a manual entry, with zero downstream changes. Manual entry is untouched. The timesheet gains a **system-logged (timer) vs manual vs total** breakdown.

**Why it's small:** the spine already exists — `time_entries` already carries `task_id`, `project_id`, `minutes`, `approval_status`, and rate/cost snapshots. This feature is just "a running timer that, on Stop, inserts a time_entry."

---

## 0. Decisions locked (do NOT re-litigate)

| # | Decision | Ruling |
|---|---|---|
| 1 | Concurrency | **Multiple concurrent timers allowed** per user, but **at most one running timer per (user, task)** — DB `UNIQUE (user_id, task_id)`; second start on the same task → 409. Different tasks may run at once. |
| 2 | Requires a task | Timer **requires a task**; `project_id` derived from the task. If the task has no project → 422. Project-level work stays manual-only. |
| 3 | Elapsed | Computed **server-side** at Stop from `now() − started_at` (never trust client clock), `Math.max(1, Math.round(ms/60000))` (min 1 minute). `entry_date` = the **start** timestamp's calendar date (overnight run lands on start day). |
| 4 | Downstream | Stop writes a normal `time_entries` row (`source='timer'`, `approval_status='pending'`, `rate_snapshot:null`) — approvals/billing/cost/margin/reconcile all work unchanged. Stays editable while pending. |
| 5 | Split | New `time_entries.source` column (`'manual'`/`'timer'`, existing rows default `'manual'`) drives the timesheet System-logged vs Manual vs Total breakdown. |
| 6 | Scope | **it_agency only, no universal files touched.** Self-service member action gated on `FEATURES.TIME_TRACKING` (NO admin gate). Ownership enforced in API code (service client bypasses RLS). |
| 7 | UI surfaces | Start/Stop on the shared `task-row.tsx` (project cockpit) **and** the cross-project Tasks view's local row + a running-timers panel on the Time Tracking page. **My Tasks (universal) is DEFERRED** — do not touch `components/dashboard/tasks/task-row.tsx`. |

---

## 1. Migration — `supabase/migrations/135_task_timers.sql`

> **135 is correct.** Local chain tops out at 133; **134 is reserved** for a pending rename — do NOT use 134. Additive, transactional, idempotent, with the `schema_migrations` self-record line (see `_TEMPLATE.sql` + any migration ≥123 for the exact convention). **Apply locally only** with `scripts/migrate-apply.sh local` — do NOT touch stage/prod.

```sql
-- Migration 135: task start/stop timers (active_timers) + time_entries.source provenance.
-- Additive only. Rollback: DROP TABLE active_timers; ALTER TABLE time_entries DROP COLUMN source;
-- Row counts: active_timers = new (0 rows); time_entries column-add only (existing rows -> 'manual' by DEFAULT).
-- Applied: local only (stage/prod HELD).

BEGIN;

-- 1. Provenance: 'manual' (form) vs 'timer' (stop of a running timer).
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','timer'));

-- 2. active_timers: at most ONE running timer per (user, task); different tasks may run at once.
CREATE TABLE IF NOT EXISTS active_timers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES tasks(id)      ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT active_timers_user_task_uniq UNIQUE (user_id, task_id)
);

ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_timers_select" ON active_timers;
CREATE POLICY "active_timers_select" ON active_timers
  FOR SELECT USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (user_id = auth.uid() OR is_tenant_admin(tenant_id))
  );

DROP POLICY IF EXISTS "active_timers_insert" ON active_timers;
CREATE POLICY "active_timers_insert" ON active_timers
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "active_timers_delete" ON active_timers;
CREATE POLICY "active_timers_delete" ON active_timers
  FOR DELETE USING (
    tenant_id IN (SELECT get_user_tenant_ids())
    AND (user_id = auth.uid() OR is_tenant_admin(tenant_id))
  );
-- No UPDATE policy: timers are write-once; "stop" = DELETE the timer + INSERT a time_entry.

CREATE INDEX IF NOT EXISTS idx_active_timers_tenant_user
  ON active_timers (tenant_id, user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_active_timers_task ON active_timers (task_id);

INSERT INTO public.schema_migrations (version) VALUES ('135_task_timers.sql')
  ON CONFLICT (version) DO NOTHING;

COMMIT;
```

Notes: `task_id`/`project_id` are `ON DELETE CASCADE` (a timer is meaningless without its task — deleting the task removes the timer, no orphan). No `updated_at` (write-once). The `UNIQUE (user_id, task_id)` is the double-start guard for decision #1.

---

## 2. API routes — `src/app/(main)/api/v1/timers/`

**House pattern on every route** (copy the preamble from `time-entries/route.ts`): `authenticateRequest()` → `apiUnauthorized()`; `getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)` → `apiForbidden()`; `scopedClient(auth)`. **NO `requireAdmin`** (self-service). Enforce per-user ownership **explicitly in code** (`.eq("user_id", auth.userId)` for non-admins) because `scopedClient` uses the service role and only isolates by tenant. Use `createRequestLogger`, `createAuditLog`, `validate`/`required`/`isUUID`, and the `apiSuccess/apiError/apiConflict/apiValidationError/apiNotFound/apiForbidden/apiUnauthorized` helpers.

Reuse the exact `select(...)` join string the manual POST/GET in `time-entries/route.ts` returns for time entries, so timer-created entries are shaped identically for the client.

### 2a. `timers/route.ts`

**GET** — list the caller's running timers.
- Non-admin: `.eq("user_id", auth.userId)`. Admin may pass `?user_id=` (mirror `time-entries` GET); default still own.
- Select: `id, task_id, project_id, started_at, created_at, tasks(id, title), projects(id, name, accounts(id, name))`, ordered `started_at asc`.
- `apiSuccess(rows)`.

**POST** — start. Body `{ task_id }`.
- `validate(body, { task_id: [required("task_id"), isUUID("task_id")] })` → `apiValidationError` on fail. (Check the exact `isUUID` helper name/signature in `src/lib/api/validation.ts`; use whatever the manual route uses to validate `task_id`.)
- Load task in-tenant: `db.from("tasks").select("id, project_id, is_billable, title").eq("id", task_id).maybeSingle()` → `apiNotFound("Task")` if missing.
- If `task.project_id == null` → `apiError("NO_PROJECT", "Task is not attached to a project", 422)`.
- Insert `{ user_id: auth.userId, task_id, project_id: task.project_id }` (tenant_id auto-injected by scopedClient), `.select(<join>).single()`.
- **On Postgres error code `23505` (unique violation) → `apiConflict("A timer is already running for this task")`.** Do NOT pre-check with a SELECT (racy) — rely on the constraint.
- `createAuditLog({ tenantId, userId, action: "timer.started", entityType: "active_timer", entityId: created.id, requestId })`. No project event (starts are high-frequency; provenance lands on the entry at stop).
- `apiSuccess(created, 201)`.

### 2b. `timers/[id]/stop/route.ts`

**POST** — stop. **Claim-then-materialize** (delete-first) for concurrency safety:
1. **Atomic claim:** conditional delete `db.from("active_timers").delete().eq("id", id)` + ownership (`.eq("user_id", auth.userId)` for non-admin; admin unrestricted) `.select("id, task_id, project_id, user_id, started_at").maybeSingle()`. **If no row returned → `apiError("ALREADY_STOPPED", "Timer is no longer running", 409)`** (a concurrent stop won the race, or it never existed / not owned). Only the winner proceeds → no double entry.
2. `const minutes = Math.max(1, Math.round((Date.now() - new Date(started_at).getTime()) / 60000));`
3. `entry_date` = calendar date of `started_at`. Compute a `YYYY-MM-DD` string from `started_at`; **comment the tz basis** (UTC unless a tenant locale/tz helper already exists — check `116_tenant_locale`; if none is trivially available, use UTC and leave a comment).
4. Re-fetch task billability: `db.from("tasks").select("is_billable").eq("id", task_id).maybeSingle()`; default `true` if the task vanished.
5. Insert into `time_entries`: `{ user_id: timer.user_id, project_id, task_id, entry_date, minutes, notes: null, is_billable, approval_status: "pending", rate_snapshot: null, source: "timer" }`, `.select(<same join as time-entries POST>).single()`. If the insert errors → `log.error` + `apiError("DB_ERROR", "Failed to log timer time", 500)` (delete-first trade-off: a failed insert loses the elapsed time; this is preferred over an insert-first double-charge risk and is a DB-outage-class event).
6. Emit the **same** signals the manual create path emits so downstream is identical — replicate exactly what `time-entries` POST does for audit + event (`time_entry.created`), plus an extra `createAuditLog({ action: "timer.stopped", entityType: "active_timer", entityId: id })`. (Check whether the manual route uses `recordProjectEvent` or a different `emitEvent` helper for `time_entry.created` and mirror it precisely.)
7. `apiSuccess(createdEntry, 201)`.

### 2c. `timers/[id]/route.ts`

**DELETE** — discard/cancel a running timer without logging time.
- Conditional delete `.eq("id", id)` + ownership (`.eq("user_id", auth.userId)` non-admin; admin unrestricted) `.select("id").maybeSingle()`. No row → `apiNotFound("Timer")`.
- `createAuditLog({ action: "timer.discarded", entityType: "active_timer", entityId: id })`. No time_entry, no event.
- `apiSuccess({ id })`.

---

## 3. Types — `src/types/database.ts`

- Add to the `TimeEntry` interface: `source: "manual" | "timer";` (place near the other time-entry fields). This is **immutable provenance** — see §5 for the PATCH guard.
- Add:
  ```ts
  export interface ActiveTimer {
    id: string;
    tenant_id: string;
    user_id: string;
    task_id: string;
    project_id: string;
    started_at: string;
    created_at: string;
  }
  ```
  Plus a joined view type for the hook/panel (co-locate in the hook file if that matches how `TimeEntryWithJoins` lives in `use-time-entries.ts`):
  ```ts
  export interface ActiveTimerWithJoins extends ActiveTimer {
    tasks: { id: string; title: string } | null;
    projects: { id: string; name: string; accounts: { id: string; name: string } | null } | null;
  }
  ```
- No event-union change needed (`createAuditLog`/event helpers take free-form strings).

---

## 4. Hooks / UI (it_agency only — touch NO universal files)

### 4a. `src/industries/it-agency/features/time-tracking/hooks/use-active-timers.ts` (new)
- Fetch `GET /api/v1/timers` on mount into `timers: ActiveTimerWithJoins[]`.
- **Live elapsed = client-side ticking, NOT server polling.** One `setInterval(() => setNow(Date.now()), 1000)` that runs **only while `timers.length > 0`** (clear it when empty); components derive `elapsedMs = now - Date.parse(started_at)`. Export `formatElapsed(ms)` (`H:MM:SS`, or `Hh Mm` for long runs).
- Refetch on `window` `focus` (+ optional 60s background refetch) so a timer started in another tab shows up.
- Expose: `timers`, `isTaskRunning(taskId) => ActiveTimerWithJoins | undefined`, `startTimer(taskId)`, `stopTimer(timerId) => createdEntry | null`, `discardTimer(timerId)`, `refetch`. `toast.error` on 409 ("already running") and non-OK; optional success toast on stop.
- Wrap in a React context: `ActiveTimersProvider` + `useActiveTimersContext()`, so the shared task-row and the panel share one hook instance without prop-drilling. **Mount the provider in the it-agency feature layer** (the Time Tracking page and/or the project-board cockpit wrapper — NOT a universal layout). If a clean shared mount point doesn't exist, fall back to instantiating the hook where the row tree mounts and passing `startTimer`/`isTaskRunning`/`stopTimer` as optional props to the rows (context is cleaner — prefer it).

### 4b. `components/task-row.tsx` (shared row — edit)
- Add a Start/Stop control **outside** the existing `isAdmin` action block (any member times their own work).
- `const running = useActiveTimersContext().isTaskRunning(task.id);`
  - Running → stop/`Square` icon + live elapsed label → `stopTimer(running.id)`.
  - Not running → `Play` "Start" → `startTimer(task.id)`.
- Disable + tooltip when `task.project_id == null` (timer needs a project). Disable while a start/stop request for this task is in flight.
- Match the existing ghost icon-buttons; render elapsed in `tabular-nums`.

### 4c. `components/views/tasks-view.tsx` (cross-project Tasks view — edit)
- This view defines its **own** local `TaskRow` (~line 365). Wire the same Start/Stop control into it, reading the same `useActiveTimersContext()`. Ensure this view tree is inside the `ActiveTimersProvider`.

### 4d. `components/running-timers-panel.tsx` (new) on `pages/timesheet.tsx`
- Renders the caller's active timers: task title, project · account, live-ticking elapsed, a **Stop** button (and optionally a discard/✕). Empty → render nothing.
- On stop, take the returned `time_entry` and call the page's add/refetch so it appears on the timesheet immediately, already tagged `source:'timer'`.
- Mount it in `timesheet.tsx` **above** `TimesheetStatsCards`, inside the `ActiveTimersProvider`.

### 4e. Source split — `lib/totals.ts` + `components/timesheet-stats-cards.tsx`
- Add to `lib/totals.ts`:
  ```ts
  export function calculateMinutesBySource(entries: TimeEntry[]) {
    let timer = 0, manual = 0;
    for (const e of entries) (e.source === "timer" ? (timer += e.minutes) : (manual += e.minutes));
    return { timer, manual, total: timer + manual };
  }
  ```
- In `timesheet-stats-cards.tsx`: keep the "Total Hours" tile's big number = total, and add a **muted sub-line** under it: `formatMinutes(timer) system-logged · formatMinutes(manual) manual`. Prefer the sub-line over a new tile (preserves the 4-col admin / 3-col member grid). Wire `calculateMinutesBySource(displayedEntries)`.
- Optional: add a `source` column to the CSV export in `timesheet.tsx`.

---

## 5. Edge cases (encode + comment)

- **Rounding/min-1:** `Math.max(1, Math.round(elapsedMs/60000))` — a 20s timer logs 1 min.
- **Midnight spanning:** `entry_date` = start-day (comment the tz basis).
- **Task/project deleted while running:** CASCADE removes the timer row (no orphan, no error). Contrast `time_entries.task_id` which stays `SET NULL` — leave that unchanged.
- **Concurrent stop:** the conditional-DELETE claim guarantees exactly one entry; the loser gets 409 `ALREADY_STOPPED`.
- **Concurrent same-task start:** `23505` → 409. Different tasks concurrently: allowed.
- **Editing a timer-origin pending entry:** it's a normal editable pending `time_entry`; **`source` is immutable** — confirm `time-entries/[id]/route.ts` PATCH whitelists fields (it does — `entry_date/minutes/notes/project_id/task_id`) and does not accept/passthrough `source`. If PATCH ever passes the body through, explicitly strip `source`. Approve/reject never touch `source`.
- **Non-it_agency / non-member:** feature gate → 403; tenant scoping + explicit `user_id` guard → 404/409.

---

## 6. Verification (Sonnet does locally; Opus re-runs)

1. `npm run build` clean; `npx eslint --max-warnings 0` clean on all new/changed files (watch `TimeEntry.source` flowing through joins/`totals.ts`/stats/CSV).
2. Apply `135_task_timers.sql` locally (`scripts/migrate-apply.sh local`); **re-run it to confirm idempotency** (no error 2nd time); confirm exactly one `135_task_timers.sql` row in `schema_migrations`. **Confirm 134 was NOT used.**
3. **Happy-path dogfood** (local, `admin@edgex.local`, a project cockpit with a task that has a project):
   - **Start** on a cockpit task → row shows running + ticking elapsed → **Stop** → a **pending** entry appears on the timesheet tagged **system-logged**.
   - Go to `/time-tracking/approvals` (and/or `/approvals`) → the entry is in the pending queue → **Approve** → `rate_snapshot` + `cost_rate_snapshot` freeze; billable amount, cost, and margin still compute (`lib/totals.ts`).
   - Cockpit + Tasks-view rows both show the Start/Stop control; running-timers panel lists the active timer with live elapsed.
4. **Multiple concurrent timers** on different tasks run at once; each stops independently → its own entry.
5. **Double-start same task** → 409 toast, still one timer. **Concurrent double-stop** (fire two) → exactly one entry, other 409.
6. **Source split:** mix manual + timer entries → Total Hours sub-line `system-logged + manual == total`, matches the table sum.
7. **Discard:** start → discard → no entry, timer gone. **Reconcile** (`tasks/[id]/reconcile`) includes timer minutes (sums by `task_id` regardless of source).
8. **Negatives:** `/api/v1/timers` as a non-it_agency tenant → 403; stopping another user's timer → 404/409.

---

## 7. Definition of done / hand-back

- Migration `135_task_timers.sql` (active_timers + `time_entries.source`), local-only, idempotent.
- `timers` API: start (409 double-start guard), list-active, stop (delete-first claim → normal pending `time_entry` `source='timer'` + same audit/event as manual), discard.
- `TimeEntry.source` + `ActiveTimer` types.
- `use-active-timers` hook + `ActiveTimersProvider`; Start/Stop on shared task-row **and** Tasks-view local row; running-timers panel on the timesheet; System-logged/Manual/Total split on the stats cards.
- **No universal files touched. My Tasks NOT modified.** Build + lint clean; §6 dogfood + negatives pass — especially: a timer-Stopped entry shows in `/approvals` and approves normally.
- **STOP. Do not commit, open/modify a PR, push, or touch stage/prod.** Report: files changed, whether the migration used 135 (not 134), dogfood results (incl. the approvals round-trip + the source split totals), negatives, any deviations. Opus reviews the diff, re-runs gates, commits on this branch.

---

## 8. Deferred (note only)
My Tasks timer (universal `components/dashboard/tasks/task-row.tsx` — needs an industry gate); global top-bar running-timer pill (stop from any page — touches universal `shell.tsx`); ">8h still running" warning; idle-detection / auto-stop; timer notes at stop.

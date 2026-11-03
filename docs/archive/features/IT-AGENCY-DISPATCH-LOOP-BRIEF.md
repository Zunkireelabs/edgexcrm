# Build brief — it_agency Delivery Round 1: the Dispatch Loop

**Branch:** `feature/it-agency-dispatch-loop`, cut off the latest `origin/stage`.
**Migration:** one — **230** (`tasks.reminded_at`). Additive, transactional, rollback line required.
**Stop at review.** Do not open a PR, do not merge, do not touch any DB but the local Docker Supabase.
**Context:** `docs/IT-AGENCY-DELIVERY-ADOPTION-PLAN.md` — read §1–§3 before starting. Commit this brief with your branch.

---

## 1. Why this exists

Prod probes on 2026-09-08 across all it_agency tenants: 22 tasks, 12 time entries, **0 milestones**, and exactly one person who has ever assigned work to another (`sadin@` → `hardik@`, `sadin@` → `anish@`). The unit of usage is a dispatcher and one doer. The loop between them is broken in three places, all verified in code, and this round fixes all three. It adds **no new delivery capability** — no new surface, no new panel, no new concept.

## 2. Scope — three slices, one PR

### Slice A — `TASK_COMPLETED` notifies the dispatcher (no migration)

Today a task reaching `done` notifies nobody; `assigned_by_id` is written on every task and read by nothing.

- Add `TASK_COMPLETED: "task.completed"` to `NotificationTypes` in `src/lib/notifications.ts`. **`notifications.type` is `TEXT` (mig 015) — no migration needed.**
- In `PATCH /api/v1/tasks/[id]` (`src/app/(main)/api/v1/tasks/[id]/route.ts`), when the patch moves `status` to `"done"` **and the previous status was not `"done"`** (no re-fire on repeat saves), notify `existingTask.assigned_by_id`.
- Use the existing `createNotificationsExcept(auth.userId, [...])` — it already suppresses self-pings, so a self-completed task notifies nobody, which is correct.
- Title: `"Task completed"`. Message: the task title. Link: `/projects/${task.project_id}` — matching the existing `TASK_ASSIGNED` link. If `project_id` is null, link to `/tasks`.
- Skip silently when `assigned_by_id` is null (self-created tasks — most of the existing 22).

### Slice B — email for assign + complete (no migration)

Notifications currently never leave the app. Hardik learns about a task only when he opens EdgeX, and he only opens EdgeX because someone told him on WhatsApp.

- **Clone the proven pattern**, do not invent one: `src/lib/email/send-lead-assigned.ts` + `src/lib/email/templates/lead-assigned.ts` are a working transactional Resend send fired on lead assignment. Build `send-task-assigned.ts` and a matching template the same way (`getResendClient()`, `EMAIL_FROM`, `APP_URL`, graceful `{ success: false }` when `RESEND_API_KEY` is absent, `createRequestLogger`).
- **Do not** use `src/lib/email/outbound/*` — that stack is the marketing-blast path (audience, cap, suppression, unsubscribe) and is the wrong shape for a transactional send.
- Fire on both events, alongside the in-app notification (never instead of it): task assigned to someone other than the actor; task completed, to `assigned_by_id`.
- **Failure is non-fatal.** Email send must never fail the API request or block the response — log and continue, exactly as the notification call does today.
- Recipient email comes from the tenant member record; resolve it the way `send-lead-assigned`'s caller does.
- **Gate:** a single tenant-level switch, default ON for `it_agency`, OFF elsewhere. Simplest thing that works — do not build a per-user preference, do not add a settings UI this round. If a `tenant_settings`-shaped home already exists, use it; if adding one would mean a migration, use a feature flag constant instead and say so in the report.

**Decisions already made — do not reopen:** instant sends, not a digest. Two event types only. No per-user preference.

### Slice C — project-task due reminders (migration 230)

`runTaskReminders` (`src/lib/inngest/jobs/reminders.ts:13`) scans `lead_checklists` only. `tasks.due_date` exists and no scheduled job has ever read it.

- **Migration 230:** `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;` plus a partial index mirroring the existing reminder indexes. Additive, transactional, `-- Rollback:` line, before/after counts in the file header per `_TEMPLATE`.
- Add a **second step** to the existing `ops-reminders-scan` Inngest function (`src/lib/inngest/functions/reminders.ts`) — `step.run("project-task-reminders", ...)`. Do not add a new scheduled function; the 15-minute cadence is already right and the free-tier budget is documented in `docs/reference/03-INNGEST-BACKGROUND-JOBS.md`.
- Query: tasks where `due_date` is in the past, `status != 'done'`, `assignee_id IS NOT NULL`, `reminded_at IS NULL`, tenant is `it_agency`. Limit 500, matching the existing scan.
- Notify the assignee with `TASK_REMINDER` (**already exists** — do not add a type). **Stamp `reminded_at` only after confirmed delivery**, exactly as `runTaskReminders` does for `lead_checklists`. This is the idempotency guarantee; a stamp-then-send ordering will silently drop reminders.
- One reminder per task, ever. No escalation, no second notice this round.

## 3. Explicitly out of scope

Do not touch: milestones, approvals, invoicing, utilization, resourcing, the cockpit layout, Home, the Positions/RBAC tier, WhatsApp, digests, notification preferences UI, or anything Phase 6 changed. No new page, no new sidebar entry. If you find yourself editing `shell.tsx`, stop.

## 4. Tests required

The bar is the regression tests, not the happy path:

- `TASK_COMPLETED` fires once on `→ done`, and **not** on a save where status was already `done`.
- No notification when the completer is the dispatcher (self-completion).
- No notification and no crash when `assigned_by_id` is null.
- Email failure (throwing/`{success:false}` sender) does **not** fail the PATCH — the request still returns 200 and the in-app notification is still written.
- Reminder scan: a due, unfinished, assigned task is notified exactly once; a second scan does not re-notify; a task whose notification throws is **not** stamped and is retried next scan.
- No reminder for a task with `due_date IS NULL` or `status = 'done'`.

## 5. Verification before you report

All four gates — `npm run lint` (not `npx eslint`), `npx tsc --noEmit`, `npm run test`, `npm run build`.

Local dev, against local Docker Supabase, with migration 230 applied locally. **Three screenshots:**

1. The bell showing "Task completed" on the dispatcher's account after a second account completed their task.
2. The task-assigned email — `EMAIL_TRANSPORT=stub` log line or a real dev inbox, either is fine; show the rendered subject/body.
3. The reminder notification arriving for a past-due task.

Report the migration file's before/after counts, and state explicitly that no stage or prod DB was touched.

## 6. Report format

Diff summary by file; each slice's decision points; the four gate results; the three screenshots; anything in this brief that conflicted with the code (say so, don't silently adapt); anything you deliberately left out.

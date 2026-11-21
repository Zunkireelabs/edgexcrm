# it_agency Delivery Round 2 — Slice C: the task panel, production-grade

**Author:** Opus planner session · **Date:** 2026-09-11
**Executor:** Sonnet session · **Reviewer:** Opus (re-reads the diff, re-runs every gate)
**Base:** `origin/stage` @ `aedca9bd` (Round 2 slice B)
**Branch:** `feature/round2-task-panel` — ONE branch, BOTH phases, ONE PR to `stage`
**Migration:** 232 (Phase 2 only)

---

## 0. Why this exists

Round 2 slice A made the task a first-class object with its own address and one
panel. Slice B fixed the two create-path bugs that were eating due dates and
swallowing assignment emails. What is left is that **the panel itself does not
look or behave like a product anyone would choose to run their week in.**

Sadin's instruction, verbatim in spirit: make the task panel Asana-class first,
*then* we add another feature. The reference is Asana's task detail pane.

This matters beyond aesthetics. The prod probe (2026-09-08) found 22 tasks, 0
milestones, and exactly one person who has ever assigned work to another. If the
place where a task lives is a form grid with a big red **Delete task** bar at the
bottom and no thread to talk in, the conversation moves to WhatsApp and the
feature stays dead. Slice C is the panel people would actually live in.

### Scope

- **Phase 1 — the redesign.** Presentation and interaction only. No schema.
- **Phase 2 — comments.** Migration 232 + one route pair + the thread UI + an
  in-app notification.

Phase 1 lands first because Phase 2's thread has to slot into a finished layout;
retrofitting it into the current form grid means doing the layout twice.

### Explicit non-goals — do NOT build these

Subtasks. Attachments. @mentions. Comment editing. Rich-text comments. Followers /
watchers. "Make public". Task-comment **email** (in-app notification only).
Multi-project attach. A custom calendar widget or any new npm dependency.
Changing what either PATCH endpoint accepts or authorizes. Touching the
`/tasks` list-route `project_id IS NOT NULL` question (that is an open product
decision for Sadin, not a code fix).

---

## 1. Ground truth — read these before writing anything

| File | Why |
|---|---|
| `src/components/dashboard/tasks/task-detail.tsx` (545 lines) | `TaskDetailBody` + `TaskDetailDrawer` — the thing being rebuilt |
| `src/components/dashboard/tasks/task-detail-modal.tsx` | drawer shell (intercepting route) |
| `src/components/dashboard/tasks/task-detail-page.tsx` | full-page shell |
| `src/app/(main)/api/v1/tasks/[id]/route.ts` | the `mode: "tasks"` endpoint — read the PATCH authorization block twice |
| `src/app/(main)/api/v1/my-tasks/[id]/route.ts` | the `mode: "my-tasks"` endpoint |
| `src/components/dashboard/tasks/task-detail.test.tsx` | the existing regression guard you must not break |
| `src/components/dashboard/tasks/task-row.tsx` | where "overdue" styling already exists — match it |
| `supabase/migrations/214_email_blasts.sql` | the table + RLS + grants idiom to copy for mig 232 |
| `supabase/migrations/_TEMPLATE.sql` | mandatory header + ledger self-record |

Orient with the code graph before grepping (`graphify explain "TaskDetailBody"`).

---

## 2. Phase 1 — the redesign

### 2.1 What is wrong today (this is the spec's justification, not padding)

1. **No primary action.** Completing a task — the single most frequent thing
   anyone does — requires opening a `To Do ▾` select and picking "Done". Asana
   puts **Mark complete** top-left as a button.
2. **Destructive action is the loudest thing on screen.** A full-width red
   *Delete task* sits pinned at the bottom, and its confirm is a two-click
   `onBlur`-cancelled hack that is unreliable (blur can fire before click).
3. **Form grid, not a detail view.** Every field is `Label` + boxed control in a
   2-col grid, so the panel reads as "fill this in" rather than "here is the task".
4. **Raw `<input type="date">`** rendering `25/12/2026`. No formatting, no
   overdue signal, no quick-set, no clear.
5. **`+ + tag`.** Real bug — `TagMultiPicker` renders a `<Plus/>` icon *and* the
   placeholder, and `task-detail.tsx` passes `placeholder="+ tag"`.
6. **Orphan time-tracking control** — a bare ▷ icon with a floating text label.
7. **Nothing in the header but an ✕.** No copy-link, no open-in-new-tab.
8. **Every edit freezes the panel.** `busy` disables all controls on each PATCH.
9. **Drawer is `sm:max-w-md`** (448px) — cramped for a description.
10. **Dead space** below the metadata.

### 2.2 Layout

`TaskDetailBody` gains one prop: `presentation: "drawer" | "page"`. It stays
**one component with one layout** — `presentation` only decides which two header
affordances render. Do not fork it into two components.

```
┌──────────────────────────────────────────────── sticky top bar ──┐
│  [✓ Mark complete]            [🔗] [↗]  [···]          (Sheet ✕) │
├──────────────────────────────────────────────────────────────────┤
│  Ship the BathroomFort hosting quote            ← big, editable   │
│  [To Do ▾]  [Urgent]  [Phase 6 Fresh Project]                     │
├──────────────────────────────────────────────────────────────────┤
│  Assignee     ( A ) Anish Balami                    ← label→value │
│  Due date     ⚠ Dec 25, 2026                          rows, NOT  │
│  Estimate     1.5 h                                   a form grid │
│  Billable     ✓ Billable                                          │
│  Tags         [hosting ×] [+]                                     │
│  Time         [▷ Start timer]  0h 45m logged                      │
├──────────────────────────────────────────────────────────────────┤
│  Description                                                      │
│  (click-to-edit; placeholder "Add a description…")                │
├──────────────────────────────────────────────────────────────────┤
│  Created Sep 10, 2026 · Assigned by Sadin Shrestha    ← quiet     │
├──────────────────────────────────────────────── Phase 2 ─────────┤
│  Comments                                                         │
│  ( SS ) Sadin · 2h ago   "client pushed the date"                 │
│  ( A ) [ Write a comment…                          ] [Comment]    │
└──────────────────────────────────────────────────────────────────┘
```

Widths: drawer `sm:max-w-xl`, page `max-w-2xl`. The body inside is identical.

`SheetContent` already renders its own absolute close button at `top-4 right-4` —
do **not** add a second ✕. Give the header icon row `pr-10` so it clears it.

### 2.3 Top bar

**Mark complete** — `Button`, left-aligned, the only filled button in the panel.

| Task state | Renders | On click |
|---|---|---|
| `status !== "done"`, `canEdit` | `[✓ Mark complete]` outline | `patch({ status: "done" })` |
| `status === "done"`, `canEdit` | `[✓ Completed]` green filled | `patch({ status: "todo" })` |
| `!canEdit` | static badge, no button | — |

Never render a disabled-looking button to someone who lacks permission — show the
read-only state. That is the PR #500 defect class the existing test guards.

**Icon row**, right, `ghost` size-`icon` buttons with tooltips:

- 🔗 **Copy link** — `${window.location.origin}/tasks/${task.id}`, toast on
  success. Reuse `src/components/ui/copy-button.tsx` if it fits; otherwise the
  same `navigator.clipboard` + `toast` shape.
- ↗ **Open in new tab** — `presentation === "drawer"` only.
  `window.open(url, "_blank", "noopener")`. **It must be a new tab, not
  `router.push`** — the URL is already `/tasks/<id>`, so a push is a no-op that
  the `@modal` route re-intercepts. A new tab is a cold load and correctly gets
  the full page.
- ··· **overflow** — `DropdownMenu`: *Copy link*, *Open in new tab*, separator,
  **Delete task** (destructive class). Only render the item when `canDelete`; if
  nothing is permitted, do not render the ··· at all.

**Delete** opens a real `AlertDialog` (`src/components/ui/alert-dialog.tsx`):
title "Delete this task?", body "This can't be undone.", cancel + destructive
confirm. Delete the `deleteOpen`/`onBlur` state machine entirely.

### 2.4 Title + chips

Title: `h1`-weight (`text-lg font-semibold`), transparent-bordered `Input` when
`canEditTitle`, plain text otherwise. Keep the existing `commitTitle` blur
semantics (empty or unchanged → revert, never PATCH an empty title).

Chip row beneath: status `Select` (or `TaskStatusBadge` read-only), `PriorityPill`,
`TaskContextChip` — all unchanged components, just relocated.

### 2.5 Metadata rows

Replace the `Label`-over-boxed-control grid with a label→value row list:

```
grid grid-cols-[7rem_1fr] gap-y-3 items-center   (single column < sm:)
```

Left cell: `text-xs text-muted-foreground`. Right cell: the control itself,
borderless until hover/focus. Empty states are actionable text, not empty boxes —
"Set due date", "Unassigned", "Add tags", "No estimate".

Rows, in order: **Assignee · Due date · Estimate · Billable · Tags · Time**.
`Estimate`, `Billable` and `Tags` render only when `mode === "tasks"` (my-tasks
PATCH does not accept them) — unchanged from today. `Time` renders only when
`task.project_id` — unchanged.

Assignee keeps today's exact branching, including the **Claim this task** button
for a non-admin looking at an unassigned project task.

**Tags: pass `placeholder="Add tags…"`, or drop the prop and take the default.**
That is the `+ + tag` fix — it is a caller bug, do not edit `TagMultiPicker`.

**Time** becomes a proper row: `TaskTimerButton` with the label in the left cell,
not a floating span.

Description moves **below** the metadata as its own titled section with more
breathing room (`rows={4}`, click-to-edit).

### 2.6 Due date control — `TaskDueDateField`

New file `src/components/dashboard/tasks/task-due-date-field.tsx`.

**No new dependency.** The repo has no calendar component and none is to be added.

- Trigger button shows `Dec 25, 2026` (`toLocaleDateString` with
  `{ year:"numeric", month:"short", day:"numeric" }`), or "Set due date" when null.
- Overdue (`due_date < today` **and** `status !== "done"`) → `text-red-600
  font-medium` with a `⚠` — identical treatment to `task-row.tsx:98-103`, and
  "Today" for today's date, same as the row.
- `today` = `toLocalDateString(new Date())` from `@/lib/date`, exactly as
  `task-list.tsx` does. **Do not** introduce a tenant-timezone path here. Yes,
  browser-local vs `tenants.timezone` is a real pre-existing drift; it is not
  this slice's to fix and fixing it in one component only would make it worse.
- `Popover` content: **Today · Tomorrow · Next week** quick buttons, a native
  `<input type="date">` for anything else, and **Clear** when a date is set.
  Compute the quick dates with `toLocalDateString` + day arithmetic.
- Read-only (`!canEdit`) → the formatted text, no trigger.

### 2.7 Optimistic updates

Today every `patch()` sets `busy`, which disables the whole panel and makes each
edit feel like a page load.

Rework `patch(fields)` to:
1. snapshot `task`,
2. apply `fields` to local state immediately,
3. fire the PATCH,
4. on `!res.ok` → restore the snapshot **and** `toast.error(...)`,
5. on success → merge the server row (authoritative: the server computes
   `assigned_by_id`),
6. `onChanged?.()` + `notifyTaskChanged()` on success only.

Drop the global `busy` disable. Keep a per-control pending affordance only where
one is genuinely needed (the Mark complete button). Title/description/estimate
keep commit-on-blur — do not make them fire per keystroke.

### 2.8 Accessibility (non-negotiable, WCAG 2.1 AA)

- Every icon-only button gets `aria-label` + a `Tooltip`.
- Overdue must not be conveyed by red alone — the `⚠` and the "Overdue" title
  attribute carry it too.
- Focus rings visible on every interactive element (`focus-visible:ring-ring`).
- `AlertDialog` traps focus and returns it to the ··· trigger on close.
- Touch targets ≥ 40px in the metadata rows.
- The `SheetTitle sr-only` that satisfies Radix's Dialog.Title requirement
  **stays** — the page variant has no Dialog context, which is exactly why the
  visible heading lives inside the body.
- Single-column metadata below `sm:`; the panel must work at 320px.

---

## 3. Phase 2 — comments

### 3.1 Migration 232

`supabase/migrations/232_task_comments.sql`. Copy the header block, RLS shape and
ledger self-record from `214_email_blasts.sql` and `_TEMPLATE.sql`. Every
statement idempotent.

```sql
CREATE TABLE IF NOT EXISTS task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id    UUID NOT NULL REFERENCES tasks(id)   ON DELETE CASCADE,
  author_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- nullable by design
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_time ON task_comments (task_id, created_at);
```

`author_id` is nullable with `ON DELETE SET NULL` (same idiom as
`email_blasts.created_by`): removing a teammate must not erase the conversation.
The UI renders such a comment as "Former member".

RLS enabled, three policies mirroring 214: tenant-member SELECT via
`get_user_tenant_ids()`, admin mutation via `is_tenant_admin(tenant_id)`,
service-role full access. Header must state: *before/after `task_comments`
0 → 0 (new empty table)*; *Rollback: `DROP TABLE IF EXISTS task_comments;`*;
*Applied: stage HELD / prod HELD*.

Note for the reviewer: migration 195 revoked `SELECT` on public tables from
`authenticated`, so these policies are belt-and-braces — the app reaches the
table through `scopedClient` (service role). No `GRANT` is needed because
nothing embeds this table via a PostgREST `!inner` from an RPC.

### 3.2 Routes

**`src/app/(main)/api/v1/tasks/[id]/comments/route.ts`**

⚠ **No `getFeatureAccess` gate.** A task can be a personal task in *any*
industry — this is the same reason `GET /api/v1/my-tasks/[id]` is ungated.
Gating on `FEATURES.ACCOUNTS` would 403 comments for every non-it_agency tenant.
Put that reasoning in a comment at the top of the file, because the sibling
`[id]/route.ts` *is* gated and the next reader will assume it was an oversight.

- **GET** — `authenticateRequest` → `scopedClient` → confirm the task exists in
  the tenant (`.from("tasks").select("id").eq("id", id).maybeSingle()`, else
  `apiNotFound("Task")`) → return comments ordered `created_at` ascending.
  Return `author_id` raw; the client maps it to a name from the
  `/api/v1/team?minimal=1` list it already fetches. Do **not** call
  `auth.admin.getUserById` per comment.
- **POST** — same auth shape. `validate` the body: required, trimmed non-empty,
  `maxLength(2000)`. Insert `{ task_id, author_id: auth.userId, body }`
  (`scopedClient` injects `tenant_id`). Return the created row.
  Any tenant member may comment — that matches GET's existing openness on both
  task endpoints, and a stricter rule would silence exactly the people we want
  talking. Then notify (§3.3). `createAuditLog` with action `task_comment.created`.

**`src/app/(main)/api/v1/tasks/[id]/comments/[commentId]/route.ts`**

- **DELETE** — author (`author_id === auth.userId`) or `requireAdmin(auth)`;
  else `apiForbidden()`. Verify the comment's `task_id` matches the route's `id`
  before deleting. Audit `task_comment.deleted`.

No PATCH. Comments are not editable in this slice.

### 3.3 Notification

Add `TASK_COMMENTED: "task.commented"` to `NotificationTypes` in
`src/lib/notifications.ts`. `notifications.type` is a plain `TEXT` column with no
CHECK constraint (migration 015) — this is a **code-only** change, no migration.

On POST, recipients = `[task.assignee_id, task.assigned_by_id]`, nulls dropped,
de-duped, and `createNotificationsExcept(auth.userId, …)` removes the actor:

```
type:    NotificationTypes.TASK_COMMENTED
title:   "New comment on a task"
message: <task title>
link:    `/tasks/${id}`
```

**In-app only. No email.** A comment nobody hears about is the same dead-feature
class as slice B's Bug B (task created, nobody emailed) — but email volume on a
chat-shaped surface is its own problem, and batching/digest is out of scope.

### 3.4 UI — `TaskComments`

New file `src/components/dashboard/tasks/task-comments.tsx`, rendered at the
bottom of `TaskDetailBody`, on both presentations.

- Section heading "Comments" + count.
- Thread: `MemberAvatar` + author name + relative time
  (`src/lib/format-relative-time.ts`) + `whitespace-pre-wrap` body. Oldest first.
- Empty state: "No comments yet. Start the conversation." — not blank space.
- Composer pinned at the bottom: avatar + `Textarea` ("Write a comment…") +
  a `Comment` button, disabled while empty or sending. **⌘/Ctrl+Enter submits.**
  Optimistic append; on failure remove the optimistic row and toast.
- Each comment shows a delete affordance on hover **only** when the viewer is the
  author or an admin.
- Loading: `Skeleton` rows, never a blank gap.
- Composer is visible to any tenant member who can see the task — do not gate it
  on `canEdit`.

---

## 4. Invariants — break any of these and the PR is rejected

**4.1 Authorization is derived, never re-invented.** These five expressions must
survive the redesign character-for-character. They mirror the two endpoints
exactly; a cosmetic round that quietly widens one is the worst possible outcome.

```ts
canEdit        = mode === "tasks" ? isAdmin || isOwner || isUnassigned : isAdmin || isOwner
canDelete      = mode === "tasks" ? canManageProjects : isAdmin || isOwner
canEditTitle   = mode === "tasks" ? isAdmin : canEdit
canEditBillable= mode === "tasks" && isAdmin
isOwner        = task.assignee_id === currentUserId || task.assigned_by_id === currentUserId
```

The assignee-picker branch (`canEdit && (mode === "my-tasks" || isAdmin)`, else
claim-button, else read-only) is part of this and also stays.

**4.2 Field sets per mode are unchanged.** `estimated_minutes`, `is_billable`
and `tags` are `mode === "tasks"` only — `PATCH /api/v1/my-tasks/[id]` does not
accept them, so rendering an editor for them on a personal task would produce a
silently-ignored edit.

**4.3 No change to either PATCH/DELETE route's accepted fields or gates.** The
only server work in this slice is the two new comments route files and the
`NotificationTypes` constant.

**4.4 One component, two presentations.** `/tasks/[id]` cold-load and the
`@modal` drawer keep rendering the same `TaskDetailBody`. Do not fork.

**4.5 `notifyTaskChanged()` still fires after every successful mutation** — the
`edgex:task-changed` event is what keeps every list in the app in sync.

**4.6 No new npm dependency.**

---

## 5. Tests

Extend, don't replace, `src/components/dashboard/tasks/task-detail.test.tsx`:

- **Existing test must still pass** — non-admin non-owner sees read-only, no
  editable controls, no delete.
- `canEdit` viewer sees **Mark complete**; non-`canEdit` viewer sees a status
  badge and **no** Mark complete button.
- A `done` task shows **Completed** and clicking it PATCHes `status: "todo"`.
- Tags render the default placeholder — **assert the string `"+ tag"` is absent**
  (the `+ +` regression guard).
- Overdue due date renders with the overdue treatment; a `done` task with a past
  due date does **not**.
- Optimistic revert: a failing PATCH restores the previous value and toasts.

⚠ **The existing `mockFetch` will mis-route comment requests.** Its first branch
matches `url.includes("/api/v1/tasks/")` and only excludes `/tags`, so
`/api/v1/tasks/<id>/comments` would be served the task object. Add a `/comments`
branch **above** it.

New `task-comments.test.tsx`: empty state renders; posting appends optimistically;
a failed post removes the optimistic row; delete affordance appears for the author
and an admin and not for a third party.

New `src/app/(main)/api/v1/tasks/[id]/comments/route.test.ts`, modelled on the
existing `[id]/route.test.ts`: 404 for a task outside the tenant; 400 on an empty
or >2000-char body; a successful POST notifies assignee + assigner and **not** the
actor; DELETE by a non-author non-admin is 403.

---

## 6. Verification — all of it, before you open the PR

```bash
npm run lint          # NOT npx eslint
npx tsc --noEmit
npm run test
npm run build
```

Then the part that is not optional (memory `feedback_no_pr_without_local_verification`):

**Local dev, local Supabase, with a screenshot of each.** Apply mig 232 to the
LOCAL Docker Supabase only (`127.0.0.1:54321`) — stage and prod are off-limits to
this session and to yours; the deploy pipeline applies it to stage on merge.

1. Drawer opened from `/tasks` — the new layout.
2. Same task at `/tasks/<id>` in a fresh tab (cold load) — the full page, same layout.
3. Mark complete → Completed → back to To Do.
4. Due-date popover open, with Today/Tomorrow/Next week/Clear.
5. An overdue task showing the red ⚠ treatment.
6. Tags row — proving there is no `+ +`.
7. Delete → the AlertDialog.
8. A comment thread with two comments + the composer.
9. The same panel at 320px width.
10. A non-admin, non-owner viewer seeing the read-only panel.

Do **not** open the PR before all ten exist.

---

## 7. The PR

One PR, `base: stage`, squash, 1 approval (ask Sadin to ping ani-shh). Do **not**
merge it yourself — stop at review. Both phases in the one PR; do not split
Phase 1 to stage early (memory `feedback_finish_features_end_to_end`).

The body must state, accurately and without overclaiming:

- what changed in the panel, and that authorization is unchanged (quote the five
  expressions from §4.1);
- that mig 232 rides this PR and is `stage HELD / prod HELD` until the deploy
  applies it;
- that comment notifications are **in-app only**, no email;
- the ten screenshots;
- the non-goals from §0 that a reviewer might otherwise assume shipped —
  subtasks, attachments, mentions, comment editing.

Then write a report for the Opus session: what you built, what you did not, every
assumption you made, and anything you found broken along the way that you did
*not* fix. Round 2 slice B's two prod bugs were found exactly that way.

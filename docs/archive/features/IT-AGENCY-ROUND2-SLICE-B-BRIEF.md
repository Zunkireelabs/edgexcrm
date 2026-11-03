# it_agency Delivery — Round 2, slice B: **capture**

Branch: `feature/it-agency-task-capture`, cut fresh off the latest `origin/stage`
(slice A is already merged there as #528). Stop at review — do not push, do not
open a PR, do not touch any database.

---

## §0 — Read this first: slice B changed shape

Slice B was scoped as "⌘K quick-add + multi-line paste → many tasks". While
grounding that scope I read the project-task create path end to end and found
**two live production bugs**. Both are in the exact endpoint a quick-add would
have to call. Building a faster capture surface on top of them would make the
product worse, faster — every task captured would silently lose its due date and
silently fail to email the person it was assigned to.

So slice B is now **two parts, in order**: fix the create path (§2), then build
capture on it (§3). Part 1 is small and is the higher-value half.

---

## §1 — The two bugs (verified by reading, not assumed)

### Bug A — the New Task dialog silently discards Due date and Priority

`src/industries/it-agency/features/project-board/components/task-create-dialog.tsx`
collects both and sends both:

```
:87    priority,
:89    if (dueDate) body.due_date = dueDate;
```

`src/app/(main)/api/v1/projects/[id]/tasks/route.ts` accepts neither. The
`validate()` schema (`:74-77`) covers only `title` and `description`, and the
`.insert({...})` payload (`:127-141`) writes `project_id, title, description,
status, estimated_minutes, is_billable, position, assignee_id, assigned_by_id`.
Grep the whole file: **the strings `priority` and `due_date` do not appear in it
at all.**

Effect on prod today: every project task created from the "New task" button is
born `priority = normal` with `due_date = NULL`, no matter what the user picked.
The user watches themselves set a due date and it evaporates.

This is very likely a real part of why the delivery suite looks abandoned, and it
reframes a Round 1 data point. Migration 230's prod run logged `UPDATE 7` —
seven already-overdue tasks — which I read at the time as "people DO set due
dates". Now I think those seven are people who set a due date *after* creating
the task, i.e. the ones who noticed it had vanished and went back to fix it by
hand. That is a much darker reading of the same number.

### Bug B — creating a task for someone else sends no email

`POST /api/v1/projects/[id]/tasks` fires only an in-app notification
(`:168-179`) and **never calls `notifyTaskAssigned`**. Compare
`src/lib/tasks/create-task.ts:224`, which does. The in-app notification it does
send links to `` `/projects/${projectId}` `` (`:176`), not `/tasks/<id>`.

So Round 1's dispatch loop covers reassignment via PATCH
(`tasks/[id]/route.ts:235`, `my-tasks/[id]/route.ts:193`) and personal-task
creation (`create-task.ts:224`) — but **not the single most common dispatch
action in an agency: creating a task for a teammate on a project.** That path has
been silent since it shipped.

It also means a claim I put in the #528 and #529 PR bodies is wrong. I wrote
"every task notification and email now links to `/tasks/<id>`, project or not."
That is true of every path slice A touched; it is not true of this one, which
slice A never touched. Nothing regressed — this route always behaved this way —
but the sentence overstated the coverage and I am correcting it here rather than
letting it stand.

---

## §2 — Part 1: fix the create path (do this first, verify it, then start §3)

Three changes, all in `src/app/(main)/api/v1/projects/[id]/tasks/route.ts`.
**No migration** — `tasks.priority` and `tasks.due_date` are existing columns
(the PATCH route on the same table already writes both).

1. **Accept `priority`.** Validate with `isIn([...TASK_PRIORITIES])` imported
   from `@/lib/tasks/create-task` — do not redeclare the priority list, it is
   already exported there. Default `"normal"` when absent.
2. **Accept `due_date`.** Same ISO-date shape the PATCH route enforces; reuse its
   validation rather than writing a third date check. `null` when absent.
3. **Call `notifyTaskAssigned`** when `assigneeIsOther`, with `taskPath` =
   `/tasks/<created.id>`, and change the in-app notification's `link` from
   `/projects/${projectId}` to `/tasks/${created.id}` to match every other path
   slice A normalized. Build the `TaskNotifyCtx` the same way
   `tasks/[id]/route.ts` does — read it there, do not invent a new shape.

**The refactor you may be tempted to do, and should not.** There are two
task-create implementations: `createTaskCore` (`src/lib/tasks/create-task.ts`,
serving `POST /api/v1/my-tasks`, the `create_task` AI tool, and the Phase 5.4c
agent approval gate) and this project route's own inline insert. They have
drifted — `createTaskCore` handles `priority`/`due_date`/`lead_id`/`deal_id` but
has **no** `project_id`; the project route handles `project_id`/`position`/
`is_billable` but none of the former. Collapsing them into one core is the right
eventual move and is **out of scope for this round** — it would put the AI tool
and the agent approval gate in the blast radius of a capture feature. Make the
three additive changes above and leave the seam. Note it as follow-up.

---

## §3 — Part 2: capture

The point of this half: **make being in EdgeX cheaper than typing it into
WhatsApp.** Every decision below serves that and nothing else. If a choice adds a
field, a confirmation step, or a modal, it is probably wrong.

### 3a — Quick-add in the ⌘K palette

`src/components/dashboard/search/global-search-palette.tsx` already exists,
already owns ⌘K, and already ends with the literal comment:

```
{/* TODO Phase 2+: "Actions" / "Ask Orca" group — AI-native palette actions */}
```

That is the seam. Build there — do not create a second palette.

Behavior: when the query is non-empty and matches no nav item, surface a top
`Actions` group with a single item — **`Create task "<query>"`**. Enter creates
it and closes the palette. One keystroke sequence, no dialog: ⌘K → type → Enter.

- The created task is assigned to **the current user** by default. Assigning to
  someone else from the palette is a natural next step but is **not in this
  round** — see §5.
- A task with no project is a personal task → `POST /api/v1/my-tasks`. A task
  with a project → `POST /api/v1/projects/<id>/tasks`. Pick the endpoint on the
  client, exactly as `task-detail.tsx` picks between the two PATCH endpoints —
  that precedent is established and reviewed; follow it rather than inventing a
  third path.
- On success: toast with the title, and the toast's action opens `/tasks/<id>`
  (slice A's route — reuse it, do not build a new detail surface).
- The palette must stay usable for its existing job. Search results still win the
  list; `Actions` is one row, not a takeover.

### 3b — Multi-line paste → many tasks

On the `/tasks` page, not in the palette (paste of 20 lines into a command
palette is a bad fit — the palette is one-line by nature).

- Paste of text containing newlines into the quick-add / New-task title field →
  offer "Create N tasks" instead of one task with embedded newlines.
- Each non-empty line becomes one task title. Trim whitespace. Strip common list
  prefixes — `-`, `*`, `•`, `1.`, `1)` — because that is exactly what a paste
  out of WhatsApp or a notes app looks like.
- Show the parsed list before creating, with the count, and let the user drop
  individual lines. This is the one confirmation step worth having: a
  mis-parse that silently creates 20 junk tasks is much worse than one extra
  keypress.
- Create them sequentially against the same endpoint 3a uses. Do **not** add a
  bulk endpoint this round.
- **Notification volume is a real risk here and is why §2 item 3 ships first.**
  Once creation emails the assignee, pasting 20 lines assigned to one teammate
  would send 20 emails. For this round, sidestep it rather than solve it: pasted
  tasks are assigned to the **current user only** (no assignee picker in the
  paste flow), so no dispatch email fires. If you find yourself writing email
  batching or digest logic, stop — that is a separate round and it needs a
  design decision from Sadin, not an implementation choice from you.

---

## §4 — Tests (required, not optional)

Slice A shipped with `task-detail.test.tsx`, the repo's first RTL component test,
and `@testing-library/react` + `jest-dom` are now devDeps. Use them.

1. **Route test** on `POST /api/v1/projects/[id]/tasks` — a request carrying
   `priority` and `due_date` persists both. This test would have failed before
   §2 and is the regression guard for Bug A. Extend the existing route test file
   if there is one; create it if not.
2. **Route test** — creating a task assigned to another user calls
   `notifyTaskAssigned` with a `/tasks/<id>` path, and does **not** call it when
   self-assigned. Mirror the spy setup in `my-tasks/[id]/route.test.ts:27-28`;
   it is already written, copy its shape.
3. **Pure unit test** on the line-parser from 3b: list-prefix stripping, blank
   lines dropped, CRLF, a single line with no newline staying a single task.
   Extract the parser as a pure function so this test needs no DOM.
4. **Component test** on the palette's Actions group — typing a query that
   matches no nav item surfaces `Create task "<query>"`; selecting it POSTs.

---

## §5 — Explicitly out of scope

Do not build these, even if they feel like one more line:

- Assignee selection from the ⌘K palette (natural-language `@name` parsing, a
  picker in the palette). Next round.
- Due-date parsing from the typed string ("fix login by friday"). Next round,
  and it wants a real decision about whether Orca does it.
- Any bulk-create endpoint, email batching, or notification digest.
- The `createTaskCore` / project-route unification described in §2.
- Anything on the education or real_estate surfaces.

---

## §6 — Gates and verification

- All four, clean, before you report: `npm run lint` (**`npm run lint`, not
  `npx eslint`**), `npx tsc --noEmit`, `npm run test`, `npm run build`.
- Local dev, against the local Supabase stack only. **No stage or prod database
  access of any kind.**
- Screenshots required, because the last two rounds needed a second pass for want
  of one:
  1. ⌘K open with the `Create task "…"` action row visible.
  2. The resulting task open at `/tasks/<id>`.
  3. The paste preview showing N parsed lines.
  4. A project task created with a due date **and** a priority, showing both
     persisted after a reload — the Bug A proof.
- In your report, state plainly which of the four gates you ran yourself and
  paste the actual counts. I re-run all of them regardless.

---

## §7 — Report back

Stop at review. One commit (or a small clean series) on
`feature/it-agency-task-capture`, nothing pushed, no PR, no migration, no DB.
Tell me anything you found that contradicts this brief — §1 is the product of
me reading the code for twenty minutes, and if part 1 turns out to be wrong I
would rather hear it than have it built around.

# Build brief — it_agency Delivery Round 2: the Task as a first-class object

**Branch:** `feature/it-agency-task-object`, cut off the latest `origin/stage`.
**Migration:** none expected — confirm before starting (see §6).
**Stop at review.** No PR, no merge, no stage/prod DB. Local Docker Supabase only.
**Context:** `docs/IT-AGENCY-DELIVERY-ADOPTION-PLAN.md` §2–§3. Commit this brief with your branch.

---

## 1. Why

Round 1 closed the dispatch loop: assign → notify → complete → notify back, in-app and by email. Proven on stage with a real delivered email. It exposed two gaps that are the same gap:

- **A task has no address.** There is no `/tasks/[id]` route and no task detail surface anywhere in EdgeX — every task interaction is inline in a list row. So every notification and email Round 1 sends links to a *list* or a *project*, never the thing itself. We tell someone work happened and then make them hunt for it. (A one-line fix landed the fallback on `/home` for now; this round supersedes it.)
- **Capture is slower than the alternative.** The adoption plan's H1: if creating a task takes longer than typing the sentence into WhatsApp, EdgeX loses every time and Round 1's notifications are decoration on an empty system.

Both are "the task isn't a real object yet." One round.

## 2. Slice A — the task detail panel (the bulk of this round)

**One component, one address, two presentations.**

- A real page at `/tasks/[id]` rendering `TaskDetail`.
- A **parallel/intercepting route** (`@modal` slot) so clicking a task *inside the app* opens the same component as a right-side drawer over the current page — URL becomes `/tasks/<id>`, no navigation, Esc and browser-back close it.
- Opening `/tasks/<id>` directly (email link, pasted link) renders the full page.

The intercepting route is the point of the slice, not a detail. A drawer built as pure UI state looks identical and still cannot be opened by an email — which is the problem we are solving. A pasted task link that opens the task is also, given where this team actually talks, quietly the most valuable thing here.

**Presentation: right-side drawer, using the existing `src/components/ui/sheet.tsx`.** `invoice-detail-drawer.tsx` (it_agency invoicing) is the working precedent — match it, do not invent a new interaction. The Sheet primitive already becomes a full-height sheet on mobile.

**Do not build a split-pane.** It forces layout reflow in three surfaces of different widths (the wide `/tasks` table, Home's half-width My Tasks card, the cockpit Tasks tab) and re-introduces exactly the per-surface duplication this round exists to remove. An overlay drawer drops into all three unchanged.

**Do not build an expand-to-modal third state.** Asana has one because their panel is narrow and holds subtasks and comments; ours has neither (§4). The full page at `/tasks/[id]` already serves "give me the whole thing".

**Panel contents — only what we already store:** title, description, status, assignee, due date, priority, estimated minutes, `is_billable`, the project / lead / deal context chip (reuse `task-context-chip.tsx`), the start/stop timer (reuse `task-timer-button.tsx`), and "assigned by" attribution. Editing follows the permissions already enforced server-side by `PATCH /api/v1/tasks/[id]` — own-vs-admin; do not invent a new permission model.

**Wire every surface to it:** the `/tasks` table rows, Home's My Tasks list, and the cockpit Tasks tab all open the drawer instead of their current inline editors. Deleting the divergent inline editing paths is the consistency win — if this round adds a fourth way to edit a task instead of collapsing three into one, it has failed.

**Then point the notifications at it.** Once `/tasks/[id]` exists, `dispatch-notify.ts` links to `/tasks/${taskId}` for both assignment and completion, project or not — replacing the `/home` fallback and the `/projects/<id>` link. Same for the email CTA. That is the whole reason the address exists.

## 3. Slice B — capture

Only after A works. Beat WhatsApp on speed:

- **Global quick-add.** The ⌘K surface already exists — type a title, pick a person, Enter. Under three seconds, no project required, from anywhere in the app.
- **Multi-line paste → multiple tasks.** One briefing conversation becomes a task list in a single action. This is the highest-leverage item in the round and the cheapest to get wrong: paste 5 lines, get 5 tasks, each assignable.

Size B after A lands; if A consumes the round, B is its own round and that is fine. **Do not start B before A is complete and reviewed.**

## 4. Explicitly out of scope

- **Subtasks and comments.** Asana's panel shows both; we have neither table. Adding them turns this into a migration-bearing round — separate decision, later.
- **`lead_checklists`.** It looks like a task and is a different table, powering lead checklist items and the existing reminder scan. It is **not** in this panel. Whether it ever converges is a later decision — do not partially unify it.
- Milestones, approvals, invoicing, utilization, resourcing, the cockpit layout, Positions/RBAC, WhatsApp transport, notification preferences.
- Any change to what `PATCH /api/v1/tasks/[id]` or `/api/v1/my-tasks/[id]` accept or authorize. This round is a surface over existing endpoints.

## 5. Tests required

- `/tasks/[id]` renders for a task in the caller's tenant; **404s for a task in another tenant** (tenant isolation — the new route is the new attack surface, treat it as such).
- The intercepting route renders the drawer for an in-app click and the full page for a direct load.
- A non-admin viewing someone else's task sees read-only controls, not editors that 403 on click (this exact defect is what PR #500 had to fix on `/tasks` — do not reintroduce it).
- `dispatch-notify` links to `/tasks/<id>` for both events, with and without a project.

## 6. Before you start

- Confirm the migration number is still free if you end up needing one: `ls supabase/migrations/ | sort | tail`. 230 is taken; 229 was taken out from under a brief mid-session once already.
- Confirm no `/tasks/[id]` route has appeared since this brief was written.

## 7. Verification

All four gates (`npm run lint` — not `npx eslint` — `npx tsc --noEmit`, `npm run test`, `npm run build`), plus local-dev screenshots:

1. The drawer open over the `/tasks` list, with the URL bar showing `/tasks/<id>`.
2. The same task at the same URL loaded directly as a full page.
3. The drawer open over Home's My Tasks (proving it is one component, not a per-surface copy).
4. A non-admin's read-only view of a task they do not own.

Report anything in this brief that conflicted with the code rather than silently adapting — the Round 1 report's flag about which endpoint the doer's surfaces actually use was the most valuable thing in it.

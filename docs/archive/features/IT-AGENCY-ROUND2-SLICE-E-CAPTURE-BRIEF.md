# Brief — it_agency Round 2 slice E: capture at the speed of WhatsApp

**Author:** Opus (planner). **Executor:** Sonnet. **Date:** 2026-09-13.
**Branch:** `feature/it-agency-capture-slice-e` off the latest `origin/stage`. **No migration.**
**Stop point:** PR open to `stage`, CI green, local-dev screenshots attached. Do not merge.

**HARD RULES**
- **No database access of any kind** — not stage, not prod, **not the local DB either** (no ad-hoc SQL to seed or reconfigure; the last slice broke this). Set up test state through the UI or the API only. If something can't be verified without SQL, stop and say so.
- Orient with `graphify explain` / `graphify path` before grepping. Never run `graphify update`.

---

## 1. Why this slice

The adoption plan (`docs/IT-AGENCY-DELIVERY-ADOPTION-PLAN.md` §3 Round 2) says Round 2 is decisive: *if creating a task takes longer than typing the sentence into WhatsApp, EdgeX loses.* Slices A–D made the task a real object and made it visible. Three capture gaps remain, all verified in code on 2026-09-13:

| Gap | Evidence |
|---|---|
| **⌘K can't give work to someone.** The whole dispatch loop is "one person telling another", and quick-add only ever creates for yourself. | `global-search-palette.tsx:203-207` — personal path sends `{ title }`, project path hard-codes `assignee_id: currentUserId` |
| **A briefing can't become a task list.** The ⌘K field is a single-line `<input>` (cmdk `CommandPrimitive.Input`), so pasted newlines are flattened into one title. | `src/components/ui/command.tsx` `CommandInput` |
| **An email can't become a task.** The lead email thread card offers only Reply. | `email-thread-card.tsx` expanded footer |

Already done — **do not rebuild**: task from a lead (`activities-panel.tsx:481` `TaskList`) and from a deal (`deal-detail.tsx:717` `TaskList`), both via the shared `TaskComposer` with `context.leadId/dealId`.

## 2. Decisions (made — do not reopen)

1. **Person picking is `@name` inside the ⌘K text.** No second field, no picker step. `Fix login copy @hardik` → task "Fix login copy" for Hardik. This is the only way it stays under three seconds.
2. **A multi-line paste creates a batch, and the assignee gets ONE email, not N.** Round 1 sends one transactional email per assignment (`dispatch-notify.ts` `fireEmail`). Pasting eight lines for Hardik must not send him eight emails — that trains people to filter EdgeX mail, which kills Round 1. One bell notification + one digest email per batch.
3. **Email → task only, not the unified inbox.** `/inbox` (mig 044 `conversations`/`messages`) is WhatsApp/SMS, and WhatsApp is broken on prod (adoption plan §4). Real email lives in lead email threads, which it_agency has (`emailMeta` includes `IT_AGENCY`). Unified-inbox → task waits for the WhatsApp fix.
4. **No link column.** The task's context is the lead (`lead_id`), which the email thread card already sits under. Pointing a task at a specific email would need a migration — not worth it until someone asks.

## 3. Changes

### 3.1 Pure parsing helpers — `src/lib/tasks/quick-add-parse.ts` (new, client-safe, no imports from server code)

```ts
export interface RosterMember { user_id: string; name: string }   // reuse the type from member-picker.tsx

/** "Fix login copy @hard" → { title: "Fix login copy", mentionToken: "hard" }.
 *  Only the LAST @token counts; earlier @s stay in the title (e.g. an email address). */
export function extractMention(query: string): { title: string; mentionToken: string | null };

/** Case-insensitive: a member matches if any word of their name starts with the token.
 *  Return all matches, max 5, stable order by name. */
export function matchMembers(token: string, roster: RosterMember[]): RosterMember[];

/** Split pasted text into task titles: split on \r?\n, strip leading bullets/numbering/checkboxes
 *  ("- ", "* ", "• ", "1. ", "1) ", "[ ] ", "[x] "), trim, drop empties, truncate each to 255.
 *  Returns at most 25 titles plus `truncated: boolean` if more were pasted. */
export function parsePastedLines(text: string): { titles: string[]; truncated: boolean };
```

Unit tests for all three, including: email addresses in a title, a token matching two people, a token matching nobody, Windows line endings, a 30-line paste.

### 3.2 ⌘K: `@person`

In `src/components/dashboard/search/global-search-palette.tsx`:

- Load the roster once per palette open, lazily on the first `@` typed: `GET /api/v1/team?minimal=1` (any member may call it; returns `{user_id, name}`). Cache in state until the palette closes.
- Apply `extractMention` to the query before the existing `showQuickAdd` check, so `@hardik` alone never matches nav.
- Quick-add rows under **Actions**:
  - no token → today's single row, unchanged: `Create task "X"`
  - token with 1–5 matches → one row per match: `Create task "X" for Hardik Shrestha`
  - token with no match → one **disabled** row: `No teammate matches "@xyz"`. Never silently create a self-task with the token stripped.
  - roster still loading → a disabled row with a spinner.
- Send `assignee_id` on both paths. The personal path (`/api/v1/my-tasks`) and the project path (`/api/v1/projects/<id>/tasks`) both accept it, and both already record the assigner and notify (slice B fixed the project path).
- Update the `CommandInput` placeholder to `Search pages, leads… or type a task, @ to assign`.

### 3.3 ⌘K: multi-line paste → batch

- Add an `onPaste` handler to the palette's `CommandInput` (it spreads `...props` into cmdk's input, so the handler is forwarded). If `parsePastedLines(clipboardText).titles.length >= 2`: `preventDefault()` and store the titles in a `pendingBatch` state. Leave the input empty so the user can still type `@name` for the whole batch. If it is one line, don't intercept.
- While `pendingBatch` is set, render an **Actions** group:
  - a preview list of the titles (max 25; show `+ N more were ignored (limit 25)` when truncated)
  - a primary row `Create N tasks` (or `Create N tasks for Hardik` when the input holds a single resolved `@token` — same match rules as §3.2, and the same disabled no-match row)
  - a `Clear` row that discards the batch
- Submit to the new bulk endpoint (§3.4) with the current project id when on `/projects/<id>`. One toast: `Created 6 tasks` with an `Open` action → `/tasks` (project page: `/projects/<id>`). On a partial failure: `Created 3 of 6 tasks — 3 failed` as an error toast.

### 3.4 Bulk endpoint — `POST /api/v1/my-tasks/bulk` (new)

Body: `{ titles: string[], assignee_id?: string | null, project_id?: string | null }`.

- `authenticateRequest()`; `scopedClient(auth)`.
- **Validate the whole batch before writing anything:** 1–25 titles, each non-empty after trim and ≤255 chars; `assignee_id` a tenant member (reuse the member check); `project_id` a project in this tenant. Any failure → `apiValidationError`, **zero rows written**.
- **Personal batch** (`project_id` absent): call `createTaskCore` once per title, sequentially, with a new option that suppresses the per-task assignment side effects (§3.5).
- **Project batch** (`project_id` present): the project create logic is currently inline in `src/app/(main)/api/v1/projects/[id]/tasks/route.ts` (feature gate, billable default via `canManageBilling`, `position`, `estimated_minutes`). **Extract it to `src/lib/tasks/create-project-task.ts`** (`createProjectTaskCore`), exactly as `createTaskCore` was extracted from `my-tasks` in Phase 5.4c. Make the route a thin wrapper, then have the bulk endpoint call the core with notify suppressed.
  - **Gate:** the route's 10 existing tests in `route.test.ts` must pass **unchanged** after the extraction. Run them before and after, and report both runs. If any test needs editing to pass, the extraction changed behaviour — stop and report.
  - The project path's feature gate (`getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)`) applies to the bulk endpoint whenever `project_id` is present.
- On a DB error mid-batch, stop and return `{ created: [...ids], failed: n }` with HTTP 207-style semantics: use `apiSuccess({ created, failed }, 200)` and let the client read `failed > 0`. No rollback: tasks already created stay (≤25, each self-contained).
- After the loop, if the assignee is someone other than the caller and at least one task was created: **one** in-app notification (`TASK_ASSIGNED`, title `N new tasks assigned`, message = first title + `and N-1 more`, link `/home`) + **one** digest email (§3.5). Nothing when self-assigned.

### 3.5 Notification suppression + digest email

- `createTaskCore` and the new `createProjectTaskCore` take `opts.notify?: boolean` (default `true`). When `false`, skip both the in-app `createNotificationsExcept` and `notifyTaskAssigned` for that task. **Keep audit log and `task.created` event per task.** Default-true keeps every existing caller (REST routes, `create_task` AI tool, agent-approved writes) byte-identical — add a test proving the default path still notifies.
- `src/lib/tasks/dispatch-notify.ts`: add `notifyTasksAssignedBatch(ctx, { assigneeUserId, titles, link })`. It follows the same rules as `fireEmail`: `isTaskEmailEnabled` gate, never email yourself, fire-and-forget, never throw.
- `src/lib/email/send-task-assigned.ts`: add `sendTasksAssignedDigestEmail`. Subject `"<actor> assigned you N tasks"`; the body lists the titles (max 25) with one button → `${APP_URL}/home`. Reuse the existing template/branding helpers in that file; don't create a second email layout.

### 3.6 Email thread → task

- `TaskComposer` (`src/components/dashboard/tasks/task-composer.tsx`) gains optional props, all backward-compatible (Home and `TaskList` callers unchanged):
  - `initialTitle?: string`, `initialDescription?: string`, `defaultExpanded?: boolean`, `onCancel?: () => void`
  - send `description` in the POST body (the API accepts ≤2000 chars; today the composer never sends it)
  - reset to the initial values, not to empty, only when used with `defaultExpanded`
- `EmailThreadCard` (`src/industries/_shared/features/email/components/email-thread-card.tsx`): new optional `leadId?: string` prop. When `leadId` is set, the expanded footer shows **Create task** left of Reply. Clicking it renders an inline `TaskComposer` under the messages:
  - `initialTitle` = `thread.subject` (fallback `Follow up: <participant>`), truncated to 255
  - `initialDescription` = plain text of the **last inbound** email (else the last email): convert `body_html` **client-side** with `new DOMParser().parseFromString(html, "text/html").body.textContent`, collapse whitespace, truncate to ~1,800 chars, prefix `From email: "<subject>" — <from_name or from_email>, <date>\n\n`. Do **not** import `htmlToText` from `src/lib/ai/ingestion/parser.ts` — it's server ingestion code and must not enter the client bundle.
  - `context={{ leadId }}`, `defaultExpanded`, `onCancel` closes it
  - `onCreated` → close the composer and toast `Task created` with `Open` → `/tasks/<id>`, and fire the existing `TASK_CHANGED_EVENT` so the lead's `TaskList` refreshes. Check how `TaskList` listens; if it doesn't listen to that event, refresh it the way `activities-panel.tsx` already does after other mutations.
- `activities-panel.tsx`: pass `leadId` to `EmailThreadCard`.
- The card is shared across 9 industries. The button is universal: task creation (`/api/v1/my-tasks`) is universal and the lead's `TaskList` already renders on every industry, so no industry gate is needed. Say so in the PR.

### 3.7 Small fix found while briefing

`GET /api/v1/team?minimal=1` returns **suspended** members (`src/app/(main)/api/v1/team/route.ts` minimal branch maps `members` without checking `suspended_at`). That roster now feeds `@` matching and already feeds `MemberPicker`, so you can assign work to someone who can't log in. In the `minimal` branch only, exclude `suspended_at IS NOT NULL`. Add a test.

### 3.8 Docs

`docs/FEATURE-CATALOG.md`: surgical edit to the tasks/quick-add row covering @assign, paste-to-batch, and email → task.

## 4. Tests (all must be green)

- `quick-add-parse.test.ts`: the cases listed in §3.1.
- Palette tests (`global-search-palette.test.tsx`), extend the existing suite:
  - `@token` with one match posts `assignee_id`
  - two matches render two rows
  - no match renders a disabled row and posts nothing
  - a multi-line paste renders the batch preview and posts to `/bulk` once
  - a single-line paste is not intercepted
  - on a project page the batch posts `project_id`
- `my-tasks/bulk/route.test.ts`:
  - an invalid batch (26 titles, empty title, foreign assignee, foreign project) writes nothing
  - a personal batch for someone else sends exactly one notification and one digest call
  - a self-assigned batch sends none
  - a project batch goes through `createProjectTaskCore` with the ACCOUNTS gate applied
  - a mid-batch DB error returns `{created, failed}`
- `createTaskCore`: the default still notifies; `notify:false` doesn't, but still writes audit and event.
- Project tasks `route.test.ts`: the 10 existing tests pass unchanged, before and after extraction.
- Team route: minimal excludes suspended.
- `EmailThreadCard`: the Create task button is shown only with `leadId`, and the composer is prefilled with subject and plain-text body.
- `npm run test`, `npx tsc --noEmit`, `npx eslint . --max-warnings 50`, `npm run build`.

## 5. Local verification (screenshots required)

Users A and B on local dev; set up through the UI only.

| # | Do | Expect |
|---|---|---|
| 1 | A, on Home: ⌘K → `Send invoice @<B's first name>` | Row `Create task "Send invoice" for B` → created. B: Home My Work + bell + (if SMTP is wired locally) one email |
| 2 | A: ⌘K → `Call vendor @zzz` | Disabled `No teammate matches "@zzz"`; nothing created |
| 3 | A: paste 6 lines (mixed `- ` bullets and `1. ` numbering) into ⌘K, type `@<B>` | Preview shows 6 clean titles; `Create 6 tasks for B` → toast `Created 6 tasks`; B has **one** bell entry `6 new tasks assigned`. Check the server log: one digest send, not six. |
| 4 | A, on a project page: paste 3 lines, no `@` | 3 project tasks in that project, self-assigned; no notification |
| 5 | A: paste 30 lines | Preview says 25 + `5 more were ignored` |
| 6 | A: open a lead with an email thread → expand → **Create task** | Composer prefilled with the subject and plain-text body (no HTML tags); save → task appears in the lead's task list and on `/tasks/<id>` with the lead chip |
| 7 | Suspend a member through the Team UI, then ⌘K `@<their name>` | They don't match |

Screenshots: rows 1 (B's Home), 3 (preview + B's bell), 6 (prefilled composer), 7.

## 6. Out of scope

Unified inbox / WhatsApp → task (waits for the channel fix) · natural-language due dates in ⌘K (`tomorrow`, `!high`) · a link column from task to a specific email · timers on personal tasks (Round 3) · changing single-task email behaviour.

## Report back

- Diff summary.
- Project route tests: before and after extraction, same 10 passing.
- Test, lint, tsc and build counts.
- The 7-row table with pass/fail, plus screenshots.
- An explicit statement that no SQL was run against any database, local included.
- PR URL, confirming it's not merged.

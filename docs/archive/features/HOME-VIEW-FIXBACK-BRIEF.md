# Home View — Fixback Brief (review findings)

> **Owner:** Opus (review) → Sonnet (execute) → Opus (review + CI + merge)
> **Branch:** new `feat/home-fixback` off current `stage` (Home already merged at `e5446f3`).
> **Scope:** two small post-review fixes. No schema, no new endpoints.

---

## Context

`feat/home-view` is already on stage and reviewed — clean and CI-green. Two minor findings from the Opus review need correcting before the next prod promotion. Both are tiny, surgical edits.

---

## Fix 1 — "My Leads" must show the user's OWN leads, not all tenant leads

`src/app/(main)/(dashboard)/home/page.tsx` currently scopes the My Leads card with `leadQueryScope(permissions, userId)`, which resolves to **"all"** for owner/admin — so an admin sees the whole tenant's leads in a card labeled "My Leads." A personal Home should always show leads assigned to the logged-in user, regardless of role.

- Change line ~30 from:
  ```ts
  getLeads(tenant.id, leadQueryScope(permissions, userId)),
  ```
  to:
  ```ts
  getLeads(tenant.id, { restrictToSelf: true, userId, limit: 50 }),
  ```
  (`getLeads` already supports `{ restrictToSelf, userId, limit }` — see `src/lib/supabase/queries.ts:53`; `restrictToSelf` applies `.eq("assigned_to", userId)`.)
- Remove the now-unused `leadQueryScope` import (line 11) and drop `permissions` from the destructure on line 24 if it becomes unused (check — it may only have been used for `leadQueryScope`). Keep eslint clean (0 errors).

## Fix 2 — keep personal tasks out of the IT-agency project workspace

Personal tasks (now `project_id` NULL) currently surface in the project-board cross-project Tasks view (admin-only) rendered with a "—" project. The `/projects` workspace should stay project-only.

- In `src/app/(main)/api/v1/tasks/route.ts`, after the base query is built (the `.from("tasks").select(...)` around line 72–74), add:
  ```ts
  query = query.not("project_id", "is", null);
  ```
  This affects ONLY the project-board's `GET /api/v1/tasks` (the project workspace). Do **not** touch `/api/v1/my-tasks` — personal tasks must still appear on Home.

---

## Hard rules

- No schema changes, no new endpoints, no migration.
- Do NOT change `/api/v1/my-tasks/*` or any Home component — only `home/page.tsx` (Fix 1) and `tasks/route.ts` (Fix 2).
- Don't weaken any existing gate (`/api/v1/tasks` stays `FEATURES.PROJECT_BOARD`-gated).

## Verify before reporting

1. `npm run build` clean AND `npx eslint --max-warnings 50` (0 errors).
2. STOP at "branch pushed, ready for review" — do NOT merge to stage, do NOT apply anything to any DB. (This has been a repeated issue — please hold at the review gate.)

---

## Sonnet handoff prompt

```
Apply the two post-review fixes in docs/HOME-VIEW-FIXBACK-BRIEF.md. Read it first.

Branch: git checkout stage && git pull --rebase origin stage && git checkout -b feat/home-fixback

Fix 1 — src/app/(main)/(dashboard)/home/page.tsx: change the My Leads fetch from
getLeads(tenant.id, leadQueryScope(permissions, userId)) to
getLeads(tenant.id, { restrictToSelf: true, userId, limit: 50 }); remove the now-unused leadQueryScope
import and any now-unused `permissions` destructure. (getLeads already supports {restrictToSelf,userId,limit}.)

Fix 2 — src/app/(main)/api/v1/tasks/route.ts: after the base tasks query is built (the .from("tasks").select(...)),
add  query = query.not("project_id", "is", null);  so the project-board workspace excludes personal tasks.
Do NOT touch /api/v1/my-tasks.

Hard rules: no schema/endpoints/migration; only those two files; don't weaken any gate.

Verify: npm run build clean AND npx eslint --max-warnings 50 (0 errors). Then STOP at "branch pushed, ready
for review" — do NOT merge to stage and do NOT apply anything to any database. Hold at the review gate.
```

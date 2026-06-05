# Personal "Home" Landing View — Implementation Brief

> **Owner:** Opus (plan) → Sonnet (execute) → Opus (review + CI + merge)
> **Branch:** `feat/home-view` off `stage`
> **Approved plan:** `~/.claude/plans/now-lets-work-on-compiled-sutherland.md`
> **Scope:** universal personal landing page + standalone-tasks schema change + thin owner-scoped "my-tasks" API. Mig + API + UI. Industry-aware (email widget education-only).

---

## Context

The post-login landing today is `/dashboard` — a tenant-wide **analytics** view (stat cards + charts). There is no *personal* home. We're adding a HubSpot-style personal Home (visual reference: `temp_ss/image.png`) showing the **logged-in user's own** work: today's schedule, tasks, leads, emails, and recent activity. `/dashboard` stays as the analytics view; `/home` becomes the new default landing.

**The one schema change:** tasks are currently project-scoped (`tasks.project_id NOT NULL`) and the whole task API surface is locked to the IT-agency project-board. To give every tenant (incl. education/Admizz, which has no projects) a real personal to-do list, we make `tasks` **standalone** and add a **separate universal, owner-scoped `/api/v1/my-tasks` API**. The existing project-board task routes are left untouched (still `FEATURES`-gated + admin-only) — we do NOT weaken them.

**Locked decisions (confirmed with Sadin):** personal standalone tasks; `/home` is the default landing + a top nav item; v1 widgets = greeting + Recent Activity (always on) + My Schedule + My Tasks + My Leads + Email snapshot (education-only).

---

## Commit A — Migration `supabase/migrations/032_personal_tasks.sql`

Use this SQL as-is (validated against mig 020's `tasks` definition + 030's RLS helpers):

```sql
-- 032_personal_tasks.sql
-- Make tasks standalone so they exist independent of a project (personal to-dos),
-- and let a member manage THEIR OWN tasks (was admin-only).

ALTER TABLE tasks ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_due
  ON tasks (tenant_id, assignee_id, due_date) WHERE assignee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_lead
  ON tasks (lead_id) WHERE lead_id IS NOT NULL;

-- Relax RLS: own-task OR tenant-admin. (The API path uses the service-role
-- scopedClient and enforces ownership in code; this keeps RLS correct as
-- belt-and-suspenders for any RLS-respecting access.)
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids())
             AND (is_tenant_admin(tenant_id) OR assignee_id = auth.uid()));
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (is_tenant_admin(tenant_id) OR assignee_id = auth.uid());
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (is_tenant_admin(tenant_id) OR assignee_id = auth.uid());
```

**DO NOT apply this migration yourself.** Opus applies it to the shared Supabase project after review, with Sadin's explicit go-ahead (shared dev+prod DB). Commit the `.sql` file only.

---

## Commit B — API: universal owner-scoped `/api/v1/my-tasks`

Two new route files. Mirror the existing patterns in `src/app/(main)/api/v1/tasks/[id]/route.ts` for validation (`validate`, `maxLength`, `optionalMaxLength`, `isIn`, the `ISO_DATE_RE` + UUID regexes) and in `src/lib/api/audit.ts` for `emitEvent`/`createAuditLog`. Use `scopedClient(auth)` and the `apiSuccess`/`apiPaginated`/`apiError`/`apiUnauthorized`/`apiForbidden`/`apiValidationError`/`apiNotFound` helpers.

**`src/app/(main)/api/v1/my-tasks/route.ts`**
- **No `getFeatureAccess` gate** — personal tasks are universal.
- `GET`: `authenticateRequest()` → `scopedClient(auth)`. Query `tasks` where `assignee_id = auth.userId`. Optional `?status=` (comma list, validate against `["todo","in_progress","done"]`). Select `*, projects(id, name), leads(id, first_name, last_name)` (both are **left** joins — a personal task has `project_id`/`lead_id` NULL). Order `due_date` asc `{ nullsFirst: false }` then `created_at` desc. Return `apiPaginated` (or a simple `apiSuccess` with `{ open: [...], completed: [...] }` split — your call; the UI wants both an open list and a completed list).
- `POST`: body `{ title (required, ≤255), due_date? (ISO YYYY-MM-DD or null), priority? (one of low/normal/high/urgent, default "normal"), lead_id? (uuid or null), description? (≤2000) }`. Insert with `assignee_id = auth.userId`, `project_id: null`, `status: 'todo'`, `tenant_id` auto-injected by scopedClient. If `lead_id` is provided, verify it belongs to the tenant (`db.from("leads").select("id").eq("id", lead_id).maybeSingle()` → 400/404 if missing). `.select().single()` the inserted row. `emitEvent({ type: "task.created", entityType: "task", entityId })` + `createAuditLog`.

**`src/app/(main)/api/v1/my-tasks/[id]/route.ts`**
- `PATCH`: own task only. Fetch the task's `assignee_id`; **return `apiForbidden()` if `task.assignee_id !== auth.userId`** (ownership check — NOT `requireAdmin`). Accept `{ status, title, due_date, priority, description }` (same validation as the project-board PATCH). Build a partial `patch` object only from provided keys. `.select().single()`. `createAuditLog` `task.updated`. This is what the UI's complete-toggle calls (`{ status: "done" }`).
- `DELETE`: own task only (same ownership check). `emitEvent`/`createAuditLog` `task.deleted`.

---

## Commit C — Query helpers + Home page + UI components

### Server-only query helpers — add to `src/lib/supabase/queries.ts`

Follow the existing helper style (service client + explicit `.eq("tenant_id", tenantId)`). Walk through that each query returns what the UI claims:

- **`getMySchedule(tenantId, userId)`** → `lead_activities` where `tenant_id = tenantId`, `user_id = userId`, `activity_type IN ('meeting','call')`, `scheduled_at IS NOT NULL`, `completed_at IS NULL`. Select `id, activity_type, subject, scheduled_at, location, lead_id, leads(id, first_name, last_name)`. Order `scheduled_at` asc. Limit ~20. (Component splits into **overdue** = `scheduled_at < now` vs **upcoming**.) `lead_activities` is universal (mig 014) — `user_id` NOT NULL is the creator/owner.
- **`getMyTasks(tenantId, userId)`** → reuse what the `/api/v1/my-tasks` GET returns, OR a direct query: `tasks` where `tenant_id`, `assignee_id = userId`; return open (`status != 'done'`) ordered by `due_date` asc nullsLast + a `done` slice (latest ~10) for the Completed toggle. Left-join `leads(id, first_name, last_name)`.
- **`getMyEmailSnapshot(tenantId, userId)`** → only called when `industryId === "education_consultancy"`. Two-step: (1) `connected_email_accounts` ids where `user_id = userId`; (2) `emails` where `connected_email_account_id IN (ids)`, `direction = 'inbound'`, `read_at IS NULL`, order `received_at` desc, limit 5; also a HEAD count for the total unread. Return `{ items, unreadCount }`. If the user has no connected inbox → `{ items: [], unreadCount: 0 }`.
- **Reuse, don't rebuild:** My Leads = `getLeads(tenantId, { restrictToSelf: true, userId })` (already filters soft-delete + converted). Recent Activity = query `notifications` where `user_id = userId` order `created_at` desc limit 8 (add a tiny `getRecentNotifications(tenantId, userId)` helper or reuse the notifications route's query). Unread-first lead ordering = reorder `getLeads` results using `unread_lead_ids` from the badge-counts query (same logic as `/api/v1/badge-counts`).

### Page — `src/app/(main)/(dashboard)/home/page.tsx` (Server Component)

Mirror `dashboard/page.tsx`: call `getCurrentUserTenant()` (gives `{ tenant, role, userId, positionName, permissions }` + the auth user for the name), then `Promise.all([...])` the helpers above. Gate the email-snapshot fetch behind `tenantData.tenant.industry_id === "education_consultancy"`. Pass everything to a client `<HomeContent>`. No `canSeeNav` gate on this page — `/home` is everyone's landing.

### Components — `src/components/dashboard/home/`

Single-column, centered `max-w-4xl`, stacked full-width cards on the `#f7f7f7` chrome. **Match HubSpot** (`temp_ss/image.png`). Reuse `Card`/`CardHeader`/`CardTitle`/`CardContent` (`src/components/ui/card.tsx`), `Badge`, `Button` (`bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg`), `formatRelativeTime` (`src/lib/format-relative-time.ts`), `toLocalDateString` (`src/lib/date.ts`), and the empty-state pattern (centered icon `h-8 w-8 text-muted-foreground/40` + muted text). Section headers: `text-xs font-medium text-muted-foreground uppercase tracking-wide`.

- **`home-content.tsx`** (client) — receives all SSR data; owns task create/complete + mark-email-read mutations; after a mutation calls `router.refresh()` (or optimistic update). Lays out the cards in order.
- **`greeting-header.tsx`** — date line (`new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" })` → "Thursday, June 4, 2026") + time-of-day greeting ("Good morning/afternoon/evening, {firstName}"). firstName from the auth user's `user_metadata.full_name` or email prefix.
- **`schedule-card.tsx`** — Today/Upcoming; rows show time (or "overdue" pill ⚠ for past-uncompleted), activity-type icon (Phone/Calendar), subject, linked lead name → links to `/leads/{lead_id}`. Empty: "Nothing scheduled."
- **`tasks-card.tsx`** + **`new-task-row.tsx`** — Open/Completed toggle; "+ New Task" inline (title + optional due date + priority) → `POST /api/v1/my-tasks`; each row has a checkbox to complete (`PATCH .../[id] {status:"done"}`), due-date label, priority pill, ✕ delete. Reuse the priority-pill + status idioms from `src/industries/it-agency/features/project-board/components/views/tasks-view.tsx`. Empty: "You have no tasks today  [+ New Task]".
- **`my-leads-card.tsx`** — assigned leads, unread-first (● dot for unread), name + status pill + relative time → `/leads/{id}`; "View all ▸" → `/leads`.
- **`email-snapshot-card.tsx`** — rendered only for education tenants. Unread inbound rows (● + from + subject + relative time) → opens the lead/thread; "View inbox ▸". Empty: "Inbox is clear."
- **`recent-activity-card.tsx`** — notifications list (title/message + relative time), each links via `notification.link`.

**"Customize"/drag-reorder is v2** — do not build it. A static "Customize" affordance can be omitted entirely for v1.

---

## Commit D — Routing, nav & the project-board null-guard

- **`src/components/dashboard/shell.tsx`**:
  - Import `House` from `lucide-react`. Add `{ href: "/home", label: "Home", icon: House }` as the **first** entry in `UNIVERSAL_NAV_TOP` (line ~55). (Universal nav uses direct Lucide component imports — this is a Client Component, so no `INDUSTRY_ICONS` string registration is needed; that registry is only for manifest-contributed items.)
  - In `handleNavModeChange` (line ~219), change the ops target `router.push("/dashboard")` → `router.push("/home")`.
  - Make `/home` always-allowed so restricted positions don't lose their landing: change `navAllowed` (line 204) to `const navAllowed = (href: string) => href === "/home" || allowedNavKeys === null || allowedNavKeys.includes(href);`.
- **`src/app/(main)/page.tsx`** (line 11): `redirect("/dashboard")` → `redirect("/home")`.
- **`src/app/(main)/api/auth/callback/route.ts`**: default `next` value `/dashboard` → `/home`.
- **`src/industries/it-agency/features/project-board/components/views/tasks-view.tsx`**: null-guard the project-name cell — a personal task (now `project_id` NULL) can appear in the it_agency cross-project Tasks view with `task.projects === null`. Render an em-dash/"—" or "No project" instead of dereferencing `task.projects.name`. Grep the file for where it reads the joined project and guard it.

---

## Hard rules

- **No edits to the existing project-board task routes** (`/api/v1/tasks/*`, `/api/v1/projects/[id]/tasks`) — they stay `FEATURES`-gated + `requireAdmin`. Personal tasks get their own `/api/v1/my-tasks` surface.
- **`/api/v1/my-tasks` is owner-scoped, not admin-scoped** — mutations check `assignee_id === auth.userId`, never `requireAdmin`. No `getFeatureAccess` gate (universal).
- **Do NOT apply migration 032** — commit the file; Opus applies it to the shared DB.
- **Email snapshot is education-only** — gate both the fetch and the card on `industry_id === "education_consultancy"`.
- **All tenant queries via `scopedClient(auth)`** (or service client + explicit `.eq("tenant_id", ...)` in `queries.ts`, matching existing helpers).
- **`/home` has no `canSeeNav` page gate** — it's the universal landing.
- Counselor scoping is inherent (every widget is own-data by construction).

## Verify before reporting back

1. `npm run build` clean **AND** `npx eslint --max-warnings 50` (0 errors). (Build alone is NOT enough — CI enforces the lint.)
2. Stop at **"branch pushed, ready for review"** — do NOT merge to stage yourself.
3. Note in your report: this needs mig 032 applied to the shared DB before a live smoke (Opus/Sadin do that).

---

## Sonnet handoff prompt

```
Implement the personal "Home" landing view per docs/HOME-VIEW-BRIEF.md. Read the brief in full first,
plus the referenced files: src/app/(main)/api/v1/tasks/[id]/route.ts and .../tasks/route.ts (patterns to
mirror), supabase/migrations/020_time_tracking.sql + 024_project_workspace_fields.sql (tasks schema),
src/app/(main)/(dashboard)/dashboard/page.tsx (SSR Promise.all pattern), src/lib/supabase/queries.ts
(getLeads + helper style), src/components/dashboard/shell.tsx (nav arrays + handleNavModeChange + navAllowed),
src/components/ui/card.tsx, src/lib/format-relative-time.ts, and
src/industries/it-agency/features/project-board/components/views/tasks-view.tsx.

Create branch feat/home-view off stage (git checkout stage && git pull --rebase origin stage && git checkout
-b feat/home-view). Implement as the four commits in the brief:
  A. Migration 032_personal_tasks.sql (commit the file ONLY — do NOT apply it to any database).
  B. /api/v1/my-tasks route.ts (GET own + POST create) and [id]/route.ts (PATCH + DELETE, owner-scoped).
  C. Query helpers in queries.ts (getMySchedule, getMyTasks, getMyEmailSnapshot, getRecentNotifications) +
     the /home Server Component page + the src/components/dashboard/home/ components (HubSpot single-column,
     reuse Card/Badge/Button/formatRelativeTime). Email snapshot card education-only.
  D. shell.tsx (Home nav item with House icon + ops toggle → /home + /home always-allowed in navAllowed),
     page.tsx redirect → /home, auth callback default next → /home, and the project-board tasks-view.tsx
     project-name null-guard.

Hard rules (brief § Hard rules): do NOT touch the existing /api/v1/tasks* routes; my-tasks is owner-scoped +
ungated; do NOT apply the migration; email snapshot gated on education_consultancy; all tenant queries scoped;
/home has no page-level canSeeNav gate.

Verify before reporting: npm run build clean AND npx eslint --max-warnings 50 (0 errors). Then STOP at
"branch pushed, ready for review" — do not merge to stage. Flag that mig 032 must be applied to the shared DB
before a live smoke.
```

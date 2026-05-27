# Project Board — In-flight Brief

> Companion to the Opus planning session that produced this brief. Sonnet (executor) reads this file end-to-end before writing any code. Opus reviews Sonnet's output between phases.

**Started**: 2026-05-27
**Lead architect**: Sadin
**Planner (this doc)**: Opus
**Executor**: a separate Sonnet session
**Status**: Planned / ready for Phase 1

---

## Context

The IT-agency tenant (Zunkireelabs CRM) now has Accounts → Projects → Tasks → Time entries → Approvals → Billable totals (Time Tracking v1) plus Leads → Contacts → Account/Project linkage (CRM Contacts v1). What's missing is the **visual layer for project lifecycle** — a kanban view of where every active client engagement sits in its delivery cycle. Today the only project view is the per-project detail page; there's no list that answers "what's in flight, what's stalled, what's about to deliver."

**Project board is industry-scoped to `it_agency`.** It's the 2nd industry-scoped feature shipped after Time Tracking + Accounts + CRM Contacts, and it reuses the `projects` table that already exists from Time Tracking (migration 020) — no parallel schema, no new top-level entity. It validates that a feature can be added to an industry that already has substantial infrastructure without disturbing universal code.

---

## Scope decisions (locked in by Sadin during planning)

- **Reuse `projects.status` enum** as the kanban column field. Extend it with `in_review` + `delivered`; backfill existing `done` → `delivered`. Migration 023.
- **No per-tenant configurable project pipelines** in v1. The enum is the source of truth. If a 2nd IT-agency tenant later wants custom stages, add a `project_pipelines` table then — non-breaking.
- **Detail page stays at `/time-tracking/projects/[id]`** for now. Board cards link to the existing URL. Moving the detail page to `/projects/[id]` is a separate refactor (cross-feature URL change, link rot risk in any deep-linked place); defer.
- **API: reuse existing `/api/v1/projects` GET and `/api/v1/projects/[id]` PATCH** — no new endpoints. PATCH already accepts `status`. No dedicated `/api/v1/projects/board` until load justifies it.
- **Drag-and-drop column moves a project's status.** TOCTOU-protected via `.eq("status", oldStatus)` precondition on the PATCH; 409 on mismatch with toast + revert. Same shape as the existing pipeline lead-move logic.
- **Cards show**: project name, account name, contact count, billable hours (from approved entries only). Click → existing project detail page.
- **Filters**: account dropdown + free-text search. No global hide/show toggle for cancelled — they're filtered out by default; admins toggle them in via a "Show cancelled" checkbox.
- **Sidebar entry**: between Accounts and Time Tracking. Icon: `LayoutGrid` (kanban-suggestive, distinct from Accounts' `Building2` and Time Tracking's `Clock3`).
- **Route**: `/projects` (top-level under `(dashboard)`).
- **No realtime updates** in v1. Stale-on-refresh is fine; we'll add Supabase realtime later if multiple admins coordinate via the board.

---

## Data model

Reuses the existing `projects` table (`supabase/migrations/020_time_tracking.sql`). Only change: extend the `status` CHECK constraint and backfill.

```sql
-- Migration 023: project board stages
-- Adds 'in_review' + 'delivered' to projects.status enum.
-- Backfills 'done' → 'delivered' (semantic merge: a "done" project IS a delivered one).

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','in_review','delivered','on_hold','cancelled','done'));

-- Note: 'done' kept in the constraint to avoid breaking any in-flight transactions during
-- the brief window between this migration and the backfill UPDATE below. Backfill nukes it.

UPDATE projects SET status = 'delivered' WHERE status = 'done';

-- Now tighten the constraint to drop 'done'.
ALTER TABLE projects
  DROP CONSTRAINT projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','in_review','delivered','on_hold','cancelled'));
```

**Status → kanban column mapping (UI labels):**

| `projects.status` | Column label | Notes |
|---|---|---|
| `planning` | Discovery | Pre-kickoff: scoping, requirements, contract |
| `active` | In Progress | Engaged work; default for new projects |
| `in_review` | Review | Client review / QA / approval gate |
| `delivered` | Delivered | Shipped to client; closed out |
| `on_hold` | On Hold | Parking lot — visible but stylistically muted |
| `cancelled` | (hidden by default) | Filtered out unless "Show cancelled" toggled |

**Column order on the board:** Discovery → In Progress → Review → Delivered → On Hold. Cancelled is a hidden bucket reachable via filter.

**No new indexes needed.** Existing `idx_projects_tenant_account` + `idx_projects_tenant_active` (partial WHERE `status = 'active'`) cover board reads. If the kanban gets slow on a tenant with 1000+ projects, add `(tenant_id, status)`. Not a v1 worry.

**RLS** unchanged. Existing policies allow tenant members to SELECT, only admins to mutate. The board is admin-only (matches `getFeatureAccess` industry gate + existing PATCH route's admin check).

---

## Industry registration

1. **`src/industries/_registry.ts`**: add `PROJECT_BOARD: "project-board"` to the `FEATURES` const.
2. **`src/industries/it-agency/features/project-board/meta.ts`**: new file exporting `projectBoardMeta` with `id: FEATURES.PROJECT_BOARD` + `industries: [INDUSTRIES.IT_AGENCY]`.
3. **`src/industries/it-agency/manifest.ts`**: import `projectBoardMeta`, push `{ meta: projectBoardMeta }` onto `features[]`. Add a `SidebarItem` to `sidebar[]`:
   ```ts
   { featureId: FEATURES.PROJECT_BOARD, href: "/projects", label: "Projects", icon: "LayoutGrid" }
   ```
   **Icon is a string, not a `LucideIcon` import** (manifest crosses Server→Client boundary; non-serializable props crash).
4. **`src/components/dashboard/shell.tsx`**: ensure `LayoutGrid` is in the `INDUSTRY_ICONS` string→component registry. Add if missing.
5. **Sidebar position**: between Accounts and Time Tracking. Order in `it-agency/manifest.ts` `sidebar[]`: Accounts → Projects → Time Tracking → CRM Contacts (or wherever Contacts currently sits — preserve relative order of unaffected entries).

---

## API surface

**Reuses existing endpoints.** No new routes.

| Route | Used for | Already exists? |
|---|---|---|
| `GET /api/v1/projects` | List projects for the board, with account join | Yes (Time Tracking Phase 2) |
| `PATCH /api/v1/projects/[id]` | Drag-drop status update | Yes (Time Tracking Phase 2) |
| `GET /api/v1/accounts` | Populate account filter dropdown | Yes (Accounts) |
| `GET /api/v1/contacts?project_id=…` (count) | Card metric: contact count | Reuse junction route; **see below** |
| `GET /api/v1/time-entries/summary?dimension=project` | Card metric: billable hours | Yes (Time Tracking Phase 5) |

### One PATCH change required (Phase 2)

`PATCH /api/v1/projects/[id]` currently doesn't enforce a TOCTOU precondition on `status`. Add: when the request body contains `status` AND the caller passes `expected_status` (new optional field), apply `.eq("status", expected_status)` to the UPDATE. Mismatch → 409 with `code: "INVALID_STATE"`, message naming the actual current status so the UI can re-fetch and re-render.

**Compatibility**: clients NOT passing `expected_status` keep the existing behavior (unconditional status update). The board ALWAYS passes it.

### Contact-count strategy

The board card wants "N contacts" per project. Options:

- **A**: per-card `GET /api/v1/contacts?project_id=…` — N+1, bad on 50+ projects.
- **B**: extend `GET /api/v1/projects` to compute `contact_count` via a PostgREST `project_contacts(count)` embed.
- **C**: do nothing in Phase 1/2; add the metric in Phase 3 once we know the card design holds.

**Pick B for Phase 3.** Cheap: one extra column in the existing query, no new endpoint. Pattern reference: `pipelines(lead_count: leads(count))` already in `/api/v1/pipelines`.

### Billable-hours strategy

Card shows "X.X billable hrs". Pull from `/api/v1/time-entries/summary?dimension=project` once per board load, key by project_id, render per card. One round-trip for all projects. Counselor scoping in that endpoint already handles non-admin views (not relevant here — board is admin-only — but inherited correctly).

---

## UI surface

```
src/industries/it-agency/features/project-board/
├── meta.ts
├── pages/
│   └── board.tsx              ← main page component (consumed by /projects shell)
└── components/
    ├── project-board.tsx      ← <DndContext>, columns, drag-end handler, optimistic state
    ├── project-column.tsx     ← single column (droppable, styled per status)
    ├── project-card.tsx       ← single project card (draggable, links to detail page)
    ├── board-filters.tsx      ← account dropdown + search + "show cancelled" checkbox
    └── status-pill.tsx        ← small status indicator (used in card + filter labels)
```

```
src/app/(main)/(dashboard)/projects/
└── page.tsx                   ← thin shell: auth → industry gate → fetch → <ProjectBoardPage>
```

### Page shell pattern

```ts
// src/app/(main)/(dashboard)/projects/page.tsx
import { notFound } from "next/navigation";
import { authenticateRequest } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ProjectBoardPage } from "@/industries/it-agency/features/project-board/pages/board";

export default async function ProjectsPage() {
  const auth = await authenticateRequest();
  if (!auth) redirect("/login");
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) notFound();
  return <ProjectBoardPage auth={auth} />;
}
```

### dnd-kit reuse

`PipelineBoard.tsx` is the model. Same primitives: `DndContext`, `closestCorners`, `PointerSensor` with a small activation distance, `DragOverlay`, `useSensor`/`useSensors`. **Do not import from `src/components/pipeline/`** — that file is lead-pipeline-specific. Build fresh under `src/industries/it-agency/features/project-board/components/`. Cross-industry-shared pieces can be hoisted later if a second industry adopts kanban patterns.

### Optimistic update flow

1. User drags project card from column A to column B.
2. `onDragEnd` mutates local state immediately (project moves to column B's array).
3. Fire PATCH `/api/v1/projects/[id]` with `{ status: B, expected_status: A }`.
4. On 200 → done.
5. On 409 INVALID_STATE → revert local state, toast "Project status changed elsewhere; refreshing…", refetch projects.
6. On other error → revert local state, toast "Couldn't update — try again". Keep current data; do not refetch.

### Card visual

```
┌────────────────────────────────┐
│ Acme — Marketing Site Refresh  │ ← name (truncate-long)
│                                 │
│ 🏢 Acme Industries              │ ← account.name (muted, smaller)
│ 👤 3 contacts                   │ ← contact_count (Phase 3)
│ ⏱  12.5 billable hrs            │ ← billable_hours (Phase 3, approved-only)
│                                 │
│ Updated 2 days ago              │ ← updated_at relative (muted, smallest)
└────────────────────────────────┘
```

Cards use shadcn `Card` + Tailwind. No new design tokens. Match the visual weight of LeadCard.tsx (do not over-decorate).

---

## Phasing

Three phases, each ships as one squashed commit on a fresh `feature/project-board-phase-{N}` branch.

### Phase 1: Schema + scaffold + static board (no drag yet)

- Migration `023_project_board_stages.sql`: extend CHECK + backfill `done` → `delivered`. Apply via Supabase MCP.
- Update `src/types/database.ts` `projects.status` literal type to include `'in_review' | 'delivered'`, drop `'done'`.
- Register `FEATURES.PROJECT_BOARD` + manifest + sidebar entry + `LayoutGrid` in shell.tsx's icon registry.
- Create the route shell `src/app/(main)/(dashboard)/projects/page.tsx` with industry gate.
- Build the **static** kanban: `<ProjectBoard>` renders columns from a hardcoded order + groups projects by `status` client-side; cards show name + account.name only; no drag-and-drop yet. `BoardFilters` skeleton (account dropdown wired, no search wired, "show cancelled" checkbox controls a filter only).
- Verify: as Zunkireelabs admin, `/projects` renders all columns + every project lands in a column based on its current status; backfill landed all "done" projects in "Delivered". As Admizz admin, `/projects` 404s. As counselor, `/projects` 404s (no PROJECT_BOARD access). As any tenant, sidebar item only appears for `it_agency` admins.

### Phase 2: Drag-and-drop + TOCTOU

- Extend `PATCH /api/v1/projects/[id]` to accept optional `expected_status`; apply `.eq("status", expected_status)` when present; 409 on mismatch with `code: "INVALID_STATE"`.
- Wire `<DndContext>` around the columns. `onDragEnd`: optimistic local move, PATCH with `expected_status: prevStatus`, revert + refetch on 409, revert + toast on other error.
- `DragOverlay` for smooth visual; sensor with `activationConstraint: { distance: 5 }` to avoid accidental drags.
- Status transitions are FREE — any column → any column. No enforced workflow (Discovery → … → Delivered) in v1; might add later if Sadin wants. **Including drag-to-cancelled and drag-back-from-cancelled.**
- Verify: drag persists across page reload; two browser windows on the same project → second drag returns 409 + toast + auto-refresh; on_hold column visible and stylistically muted; cancelled column hidden by default, visible when "show cancelled" toggled.

### Phase 3: Filters + card metrics

- Account filter dropdown (populated from `GET /api/v1/accounts`); search box (client-side substring match on project name).
- Extend `GET /api/v1/projects` select with `project_contacts(count)` PostgREST embed. Card renders `{contact_count} contacts`.
- Card fetches billable hours from `/api/v1/time-entries/summary?dimension=project` (one request per board load), keys by project_id. Card renders `{hours.toFixed(1)} billable hrs`. Hours = `billable_minutes / 60`.
- Empty-state polish: column shows "No projects in this stage" muted text; full board with no projects shows a single CTA "Create a project →" linking to the existing accounts/[id] new-project form.
- Verify: account filter narrows board; search filters across all columns; contact count + billable hours match what's on the detail page.

---

## Per-phase verification matrix

Sonnet runs each row before reporting back. Failures get fixed before the next phase starts.

### Phase 1

- [ ] `npm run build` clean.
- [ ] Migration applied: `SELECT DISTINCT status FROM projects` returns no `'done'`, has at least `'planning' | 'active' | 'in_review' | 'delivered'` if existing data covers them.
- [ ] As Zunkireelabs admin (`admin@zunkireelabs.com / admin123`): sidebar shows "Projects" between Accounts and Time Tracking; `/projects` renders the 5 default columns; projects appear in the correct column based on `status`; click on a project card navigates to `/time-tracking/projects/[id]`.
- [ ] As Admizz admin (creds rotated; ask Sadin to reset before Phase 1 verification): `/projects` 404s; "Projects" item absent from sidebar.
- [ ] As Zunkireelabs counselor (creds rotated; ask Sadin): `/projects` 404s.
- [ ] `industryId === "it_agency"` is the only gate; education tenants don't see Projects nav.

### Phase 2

- [ ] All Phase 1 checks still pass.
- [ ] Drag a project from In Progress → Review → reload page → it stays in Review.
- [ ] Open the same project in two tabs as Zunkireelabs admin. Drag in tab 1: succeeds. Drag in tab 2 (now stale): 409 toast + auto-refetch + card shows new state.
- [ ] PATCH without `expected_status` (e.g. via curl): unconditional update still works (back-compat).
- [ ] Drag from In Progress → Cancelled (with "show cancelled" enabled) → cancelled column receives card; drag back → returns. No workflow restriction.
- [ ] On_hold column visible and visually muted.

### Phase 3

- [ ] All Phase 2 checks still pass.
- [ ] Account filter: select an account → board shows only that account's projects; clear filter → all return.
- [ ] Search: type partial project name → only matching cards visible across columns.
- [ ] Contact count on card matches `SELECT COUNT(*) FROM project_contacts WHERE project_id = X`.
- [ ] Billable hours on card matches what `/time-tracking/projects/[id]` shows in its billable totals card.
- [ ] Empty-stage placeholder visible in empty columns; full-board CTA visible if no projects exist for tenant.

---

## Non-goals (v1)

- **Configurable per-tenant stages.** Hardcoded mapping to the enum. If a 2nd IT-agency tenant wants different stages, build `project_pipelines` table then.
- **Realtime updates.** Stale-on-refresh accepted.
- **Activity log per project / kanban-card.** Already covered on the detail page.
- **Card editing in place.** Click → detail page is the only edit path.
- **Bulk operations** (multi-select, bulk status change). Not yet.
- **Sort within a column** (by date, by name, …). Default: most recently updated first. No user control.
- **Workflow enforcement** (must go Discovery → … → Delivered). All transitions free.
- **Custom column colors / per-stage SLA timers.** Visual polish only — same column treatment for all.

---

## Open questions

- **None blocking Phase 1.** Phase 2 question: should `cancelled` and `delivered` be a single right-of-board archive zone, or distinct columns? Brief locks in distinct (cancelled hidden, delivered visible) — re-revisit if delivered-column gets too crowded for active tenants.

---

## Code-review checklist (apply before reporting each phase complete)

The 6 standing items (see STATUS-BOARD § "Code-review checklist additions"):

1. **PostgREST embed FK disambiguation** — N/A for v1 (`accounts` already disambiguated in existing routes; `project_contacts(count)` is a count embed, no FK choice). Re-check in Phase 3.
2. **PATCH preserves POST invariants** — N/A; PATCH route only modifies `expected_status` precondition, no new invariants.
3. **New page components need a route shell** — `<ProjectBoardPage>` MUST have `src/app/(main)/(dashboard)/projects/page.tsx` in the same Phase 1 commit. No "exported but not wired" state.
4. **`.select()` after insert/update matches read shape** — N/A (no new insert/update routes).
5. **Radix Select forbids empty-string `<SelectItem value="">`** — applies to account filter dropdown in Phase 3. Use a sentinel like `"__all__"` for "all accounts", map to undefined on submit.
6. **Cross-cutting predicate audits must grep the whole repo** — applies to the `'done'` → `'delivered'` migration. Phase 1 MUST `grep -rn "'done'" src/ --include='*.ts' --include='*.tsx'` and fix every hit that compares `projects.status`. Likely includes: ProjectForm status dropdown, project-detail page status badge, any place rendering status label.

---

## Workflow reminders

- **Opus plans + reviews + pushes to stage + writes docs.** This brief is the contract.
- **Sonnet writes ALL code on `feature/project-board-phase-{N}` branches**, including small fixbacks Opus catches in review.
- **Local-verify-before-push.** Sonnet runs `npm run build` + the per-phase verification matrix before reporting back.
- **Per-phase squash merge.** Opus reviews diff, runs independent smoke, squashes Sonnet's branch into a single commit on stage, deletes the branch.
- **Production promotion happens after all phases ship + a quiet observation window.** Stage→main is Opus's call, gated on Sadin's go-ahead.

---

## Glossary

- **Status / stage** — same thing in this brief. The kanban column. `projects.status` in the DB; "stage" or "column" in UI copy.
- **Project board** — the kanban view at `/projects`.
- **Project detail page** — the existing page at `/time-tracking/projects/[id]` (unmoved in v1).
- **TOCTOU** — time-of-check vs time-of-use. Race condition between reading current status and writing new status; solved by `.eq("status", expected_status)` precondition.
- **Optimistic update** — UI moves immediately on drag; reverts on server error.

# Time Tracking — In-flight Brief

> Companion to the Opus planning session that produced this brief. Sonnet (executor) reads this file end-to-end before writing any code. Opus reviews Sonnet's output between phases.

**Started**: 2026-05-25
**Lead architect**: Sadin
**Planner (this doc)**: Opus
**Executor**: a separate Sonnet session
**Status**: Planned / ready for Phase 1

---

## Context

The IT-agency tenant (Zunkireelabs CRM) tracks billable work in a Google Sheet today — one row per (date × client × project × task) with per-member minute columns. The in-product time tracker replaces that. It's also the **first industry-scoped feature for `it_agency`**, validating the new industry-module pattern with real parallel-work isolation: all of this lands under `src/industries/it-agency/` and touches zero files owned by `education-consultancy`.

---

## Scope decisions (locked in by Sadin during planning)

- **Task-level** tracking (Project → Tasks → Time entries), not just project-level.
- **Per-member default rates + per-project override** for billable amounts.
- **Approvals**: tenant admins/owners can approve/reject any team member's entries.
- **Single-Account model** (no sub-brand hierarchy) — e.g. `CarbonSpark` is one Account, `BathroomFort Website` is a Project under it.
- **Reuse leads** as contacts attached to accounts (existing leads table gains an `account_id` FK). A "client contact" is a lead under an account; an account can have multiple lead contacts.

---

## Data model

```
tenants                      [existing]
  │
  ├── tenant_users           [existing]   + default_hourly_rate (NUMERIC, nullable)
  │
  ├── accounts (NEW)         Companies/brands (CarbonSpark, Admizz, Prime). Tenant-scoped.
  │     │                    Columns: id, tenant_id, name, primary_contact_email,
  │     │                    notes, is_active, created_at, updated_at.
  │     │
  │     ├── leads            [existing]   + account_id (UUID, nullable FK → accounts)
  │     │                    Lets a contact (Manish Shah) be tied to an account (Admizz).
  │     │
  │     └── projects (NEW)   Engagements per account (BathroomFort Website, Admizz SEO).
  │           │              Columns: id, tenant_id, account_id, name, status
  │           │              (planning/active/on_hold/done/cancelled), default_rate
  │           │              (NUMERIC, nullable — overrides member rate), is_billable
  │           │              (default true), notes, created_at, updated_at.
  │           │
  │           └── tasks (NEW)
  │                 │        Work items within a project.
  │                 │        Columns: id, tenant_id, project_id, title, description,
  │                 │        status (todo/in_progress/done), estimated_minutes (INT,
  │                 │        nullable), is_billable (default true), position (INT,
  │                 │        for sort), created_at, updated_at.
  │                 │
  │                 └── time_entries (NEW)
  │                          Columns: id, tenant_id, user_id (member), task_id (FK,
  │                          nullable — generic project-time logging allowed),
  │                          project_id (FK, required — denormalized from task or
  │                          set directly), entry_date (DATE), minutes (INT > 0),
  │                          notes (free text), is_billable (denormalized from task
  │                          at create time so retroactive flag flips don't change
  │                          historic entries), rate_snapshot (NUMERIC, locked on
  │                          approval — preserves invoice integrity),
  │                          approval_status ('pending'/'approved'/'rejected'),
  │                          approved_by (FK auth.users, nullable), approved_at
  │                          (TIMESTAMPTZ, nullable), rejection_reason (TEXT,
  │                          nullable), created_at, updated_at.
```

**Isolation pattern** (mandatory for every new tenant-owned table):

- `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- SELECT policy: `tenant_id IN (SELECT get_user_tenant_ids())`
- Mutation policies: `is_tenant_admin(tenant_id)` for `accounts`, `projects`, `tasks`.
- `time_entries` is an exception — members need to insert/update their **own** entries, not just admins. Policy: `tenant_id IN (...)` AND `user_id = auth.uid()` for INSERT/UPDATE; admins (`is_tenant_admin(tenant_id)`) can update any (needed for approval flow); DELETE admin-only.

**Migration file**: `supabase/migrations/020_time_tracking.sql` — one file with all `CREATE TABLE` + `ALTER TABLE` (`tenant_users.default_hourly_rate`, `leads.account_id`) + RLS policies + indexes. One migration is simpler to rollback than five.

**Indexes** (minimum set):
- `accounts(tenant_id, is_active)` partial WHERE `is_active = true`
- `projects(tenant_id, account_id)`, `projects(tenant_id, status)` partial WHERE `status = 'active'`
- `tasks(tenant_id, project_id, position)`
- `time_entries(tenant_id, user_id, entry_date DESC)`, `time_entries(tenant_id, project_id, entry_date DESC)`, `time_entries(tenant_id, approval_status)` partial WHERE `approval_status = 'pending'`

---

## API surface

All routes live under `src/app/(main)/api/v1/` (Next.js requires it). Each is industry-gated immediately after `authenticateRequest()`:

```ts
const auth = await authenticateRequest();
if (!auth) return apiUnauthorized();
if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
```

Each route uses `scopedClient(auth)` (not raw `createServiceClient()`) — see `src/lib/supabase/scoped.ts`. Tenant filter is auto-injected; `tenant_id` is stripped from `update()`/`insert()` payloads.

```
/api/v1/accounts                       GET list, POST create
/api/v1/accounts/[id]                  GET, PATCH, DELETE
/api/v1/accounts/[id]/leads            GET (lead-contacts linked to this account)

/api/v1/projects                       GET (filter ?account_id=...&status=...), POST
/api/v1/projects/[id]                  GET, PATCH, DELETE
/api/v1/projects/[id]/tasks            GET, POST

/api/v1/tasks/[id]                     GET, PATCH, DELETE
                                       (no /tasks top-level list — always project-scoped)

/api/v1/time-entries                   GET (?user_id=...&from=...&to=...&project_id=...
                                       &approval_status=...), POST
/api/v1/time-entries/[id]              GET, PATCH (members can edit own pending entries
                                       only; admins can edit any), DELETE
/api/v1/time-entries/[id]/approve      POST (admin only) — sets approval_status='approved',
                                       approved_by, approved_at; locks rate_snapshot
/api/v1/time-entries/[id]/reject       POST (admin only) — sets approval_status='rejected',
                                       rejection_reason

/api/v1/time-entries/summary           GET (?dimension=member|project|account&from=&to=)
                                       — rollups: total minutes, billable minutes, billable $
                                       totals per dimension key

/api/v1/team                           [existing] — PATCH gains optional `default_hourly_rate`
                                       field (admin-only update)
```

**Patterns to reuse from existing code:**
- Response helpers: `src/lib/api/response.ts` (`apiSuccess`, `apiError`, `apiUnauthorized`, `apiForbidden`, `apiNotFound`, `apiValidationError`, `apiPaginated`)
- Validation: `src/lib/api/validation.ts` (`validate`, `required`, `maxLength`, `optionalMaxLength`, `isUUID`)
- Auth helpers: `src/lib/api/auth.ts` (`authenticateRequest`, `requireAdmin`)
- Logging: `src/lib/logger.ts` (`createRequestLogger`)
- Audit + events: `src/lib/api/audit.ts` (`createAuditLog`, `emitEvent`) — emit `time_entry.approved`, `time_entry.rejected`, etc.
- DB client: `src/lib/supabase/scoped.ts` (`scopedClient(auth)`)
- Industry gate: `src/industries/_loader.ts` (`getFeatureAccess`)

**Rate resolution logic** (lives in `src/industries/it-agency/features/time-tracking/lib/rates.ts`):

```ts
// Effective rate for a time entry = project.default_rate (if set) else member.default_hourly_rate (if set) else 0
function resolveEffectiveRate(project: Project | null, member: TenantUser): number {
  return project?.default_rate ?? member.default_hourly_rate ?? 0;
}
```

Snapshot at approval time: `time_entries.rate_snapshot = resolveEffectiveRate(...)` so future rate changes don't retroactively change historical billing.

---

## UI surface

Five pages. Files live at `src/industries/it-agency/features/time-tracking/`. Thin route shells under `src/app/(main)/(dashboard)/...` delegate to them and call `getFeatureAccess(...) → notFound()`.

| Route | Page component (in industry module) | What it shows |
|---|---|---|
| `/time-tracking` | `pages/time-tracking-home.tsx` (`TimeTrackingHomePage`) | The daily log — current member's entries grouped by date, ordered week-then-day-descending. Inline "add entry" form. Quick filters: project, date range. Members see their own; admins see a filter to view any member. Most-used surface. |
| `/time-tracking/accounts` | `pages/accounts-list.tsx` (`AccountsListPage`) | List of tenant's accounts. Project count + total billable hours-this-month per row. Click-through to detail. "Create account" action. |
| `/time-tracking/accounts/[id]` | `pages/account-detail.tsx` (`AccountDetailPage`) | Account header. Linked lead-contacts list (read-only, pulls from `/api/v1/accounts/[id]/leads`). Projects under this account (inline list with status + hours rollup). Inline create-project. |
| `/time-tracking/projects/[id]` | `pages/project-detail.tsx` (`ProjectDetailPage`) | Project header (account name, status, default rate). Tasks list with inline create/edit (no separate task pages). Recent time entries against this project (latest 50). Total billable hours + total billable $ for the project. |
| `/time-tracking/approvals` | `pages/approvals-queue.tsx` (`ApprovalsQueuePage`) | Admin/owner only. Pending entries across all members + projects, batched by member or by date (toggle). Approve / reject (with reason) per entry. Bulk-approve action. |

**Sidebar nav**: one entry `"Time Tracking" → /time-tracking` icon name `"Clock"` (Lucide). The icon name must be added to `INDUSTRY_ICONS` in `src/components/dashboard/shell.tsx`.

**Component layer**: shadcn primitives from `src/components/ui/`. Reuse `Sheet`, `Dialog`, `Select`, `Input`, `Button`, `Card`, `Badge` (for status), `Tabs` (for approval queue grouping toggle). No drag-and-drop is needed for v1; `dnd-kit` patterns from `src/components/pipeline/` are NOT to be replicated here.

**Industry-scoped module layout**:

```
src/industries/it-agency/
├── manifest.ts                       (registers TIME_TRACKING + sidebar entry)
├── features/time-tracking/
│   ├── meta.ts                       ({ id: FEATURES.TIME_TRACKING, industries: [IT_AGENCY] })
│   ├── pages/
│   │   ├── time-tracking-home.tsx
│   │   ├── accounts-list.tsx
│   │   ├── account-detail.tsx
│   │   ├── project-detail.tsx
│   │   └── approvals-queue.tsx
│   ├── components/
│   │   ├── time-entry-row.tsx
│   │   ├── time-entry-add-form.tsx
│   │   ├── account-form.tsx
│   │   ├── project-form.tsx
│   │   ├── task-row.tsx
│   │   ├── rate-input.tsx
│   │   └── status-badge.tsx
│   ├── hooks/
│   │   ├── use-time-entries.ts       (client-side fetch + local cache)
│   │   └── use-approvals.ts
│   └── lib/
│       ├── rates.ts                  (resolveEffectiveRate)
│       └── totals.ts                 (billable subtotal calculators)
└── ai/agent.ts                       (stub, untouched in this feature)
```

---

## Industry scoping wiring (mandatory steps)

Exactly the pattern check-in and form-builder use. Sonnet should NOT invent variations.

1. **`src/industries/_registry.ts`** — add `TIME_TRACKING: "time-tracking"` to the `FEATURES` constant.
2. **`src/industries/it-agency/manifest.ts`** — replace `features: []` and `sidebar: []` with:
   ```ts
   import { FEATURES, INDUSTRIES } from "../_registry";
   import { timeTrackingMeta } from "./features/time-tracking/meta";
   import { aiConfig } from "./ai/agent";
   import type { IndustryManifest } from "../_types";

   export const manifest: IndustryManifest = {
     id: INDUSTRIES.IT_AGENCY,
     features: [{ meta: timeTrackingMeta }],
     sidebar: [
       { featureId: FEATURES.TIME_TRACKING, href: "/time-tracking", label: "Time Tracking", icon: "Clock" },
     ],
     ai: aiConfig,
   };
   ```
3. **`src/components/dashboard/shell.tsx`** — add `Clock` to the lucide-react imports and to the `INDUSTRY_ICONS` registry.
4. **Page route shells** (the 5 routes above) — each follows this template:
   ```ts
   import { redirect, notFound } from "next/navigation";
   import { getCurrentUserTenant } from "@/lib/supabase/queries";
   import { getFeatureAccess } from "@/industries/_loader";
   import { FEATURES } from "@/industries/_registry";
   import { TimeTrackingHomePage } from "@/industries/it-agency/features/time-tracking/pages/time-tracking-home";

   export default async function Page() {
     const tenantData = await getCurrentUserTenant();
     if (!tenantData) redirect("/login");
     if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.TIME_TRACKING)) notFound();
     return <TimeTrackingHomePage tenantId={tenantData.tenant.id} role={tenantData.role} />;
   }
   ```
5. **API routes** — each gets the gate after `authenticateRequest()`:
   ```ts
   const auth = await authenticateRequest();
   if (!auth) return apiUnauthorized();
   if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
   ```
6. **`docs/FEATURE-CATALOG.md`** — Sonnet adds a row under "Industry-scoped":
   ```
   | FEATURES.TIME_TRACKING (`time-tracking`) | src/industries/it-agency/features/time-tracking/ | it_agency | Account/project/task hierarchy + time entries + approvals + billable totals. |
   ```

---

## Phasing — Sonnet ships in 5 commits, Opus reviews between each

Each phase ends with: `npm run build` clean → Sonnet commits → reports back → Opus reviews → manual UI smoke as Zunkireelabs (IT) AND Admizz (Education) tenants → push to `stage` only after Opus approves. **Sonnet does NOT push to stage directly; that's Opus's gate.**

### Phase 1 — Schema + auth + manifest scaffolding (~0.5 day)

- Write `supabase/migrations/020_time_tracking.sql`.
- Update `src/types/database.ts` with `Account`, `Project`, `Task`, `TimeEntry` interfaces + extend `Lead` (add `account_id`) and `TenantUser` (add `default_hourly_rate`).
- Add `FEATURES.TIME_TRACKING` to `_registry.ts`.
- Create `src/industries/it-agency/features/time-tracking/meta.ts`.
- Update `src/industries/it-agency/manifest.ts` per template above.
- Add `Clock` to `INDUSTRY_ICONS` in `shell.tsx`.
- Create the 5 empty page shells that render `<div>Time Tracking — coming soon</div>` placeholder for IT, `notFound()` for non-IT.
- Build green. Manual smoke: Zunkireelabs tenant sees "Time Tracking" in sidebar; clicking it shows the placeholder. Admizz tenant: no sidebar item, `/time-tracking` 404s.

### Phase 2 — Accounts + Projects + Tasks CRUD (~1.5 days)

- All API routes for accounts, projects, tasks (no time entries yet).
- `AccountsListPage`, `AccountDetailPage`, `ProjectDetailPage` with create/edit/delete flows.
- Admin-only mutations (use `requireAdmin(auth)` after the industry gate).
- `AccountForm`, `ProjectForm`, `TaskRow` components.
- Manual smoke: Sadin can create CarbonSpark account → create BathroomFort Website project → add 3 tasks. As a viewer-role member, mutations are blocked.

### Phase 3 — Time entries log + list + edit (~1.5 days)

- Time entries API: POST, GET (with all filters), PATCH (own entries if pending, admin can edit any), DELETE (admin or own + pending).
- `TimeTrackingHomePage` with `TimeEntryAddForm` and `TimeEntryRow` components. Week-grouped list of own entries.
- No rates yet, no approval flow yet — all entries are status `pending` by default; no admin queue page yet.
- Manual smoke: log 5 entries against a project, see them grouped by date, edit one, delete one. Math (minutes → hours) displays correctly.

### Phase 4 — Approvals (~0.5 day)

- Approve/reject API endpoints.
- `ApprovalsQueuePage` admin-only page with grouped pending entries + approve/reject actions + bulk-approve.
- `StatusBadge` component shows pending/approved/rejected on entries in the home page list.
- Members can no longer edit/delete approved or rejected entries (API enforces).
- Manual smoke: as admin, see pending queue, approve 3, reject 2 with a reason. As member, see status badges + rejection reason on rejected entries.

### Phase 5 — Rates + billable totals (~1 day)

- Extend team page (or settings) so admin can set `default_hourly_rate` on each member. Update `/api/v1/team` PATCH.
- `RateInput` component (NUMERIC, currency symbol cosmetic).
- Add `default_rate` field to `ProjectForm`.
- `lib/rates.ts` with `resolveEffectiveRate`.
- On approval, snapshot the rate into `time_entries.rate_snapshot`.
- `lib/totals.ts` with `calculateBillableMinutes`, `calculateBillableAmount`.
- Show billable totals on project detail page and approvals queue.
- `/api/v1/time-entries/summary` endpoint for cross-cutting reports (used by future report pages; surface minimally on home page as "this week's total").
- Manual smoke: set $X rate on Anish, set $Y override on BathroomFort project. Log entry against BathroomFort → effective rate is Y. Approve → rate_snapshot = Y. Change Y on project → existing entry's rate_snapshot unchanged.

**Total v1 estimate: 4–5 working days for Sonnet execution. Opus review adds incremental hours between phases.**

---

## Files modified / created (summary)

**New:**
- `supabase/migrations/020_time_tracking.sql`
- `src/industries/it-agency/features/time-tracking/{meta.ts, pages/* (5), components/* (~7), hooks/* (2), lib/* (2)}` — ~18 files
- 5 thin page shells: `src/app/(main)/(dashboard)/time-tracking/{page.tsx, accounts/page.tsx, accounts/[id]/page.tsx, projects/[id]/page.tsx, approvals/page.tsx}`
- ~14 API route files: `src/app/(main)/api/v1/{accounts/route.ts, accounts/[id]/route.ts, accounts/[id]/leads/route.ts, projects/route.ts, projects/[id]/route.ts, projects/[id]/tasks/route.ts, tasks/[id]/route.ts, time-entries/route.ts, time-entries/[id]/route.ts, time-entries/[id]/approve/route.ts, time-entries/[id]/reject/route.ts, time-entries/summary/route.ts}`

**Modified:**
- `src/industries/_registry.ts` — add `TIME_TRACKING` constant
- `src/industries/it-agency/manifest.ts` — populate features + sidebar
- `src/components/dashboard/shell.tsx` — add `Clock` icon to registry + lucide imports
- `src/types/database.ts` — new interfaces + extend `Lead`, `TenantUser`
- `src/app/(main)/api/v1/team/route.ts` — PATCH accepts `default_hourly_rate`
- `docs/FEATURE-CATALOG.md` — add row
- `docs/FEATURE-ROADMAP.md` — move to "Recently shipped" after Phase 5
- `docs/SESSION-LOG.md` — one entry per phase (Opus writes these on review)
- `docs/STATUS-BOARD.md` — close "first IT-agency feature" item

---

## Verification (Opus runs at each phase boundary)

1. **Build clean**: `npm run build` passes, no TypeScript errors.
2. **Lint clean** (warnings OK, no errors).
3. **Industry gate as IT (Zunkireelabs)**: sidebar item appears, all 5 pages render (phase-appropriate functionality), API endpoints return 200 with valid data.
4. **Industry gate as Education (Admizz)**: NO sidebar item, direct URL `/time-tracking*` returns 404, all API endpoints return 403.
5. **No regression**: Check-in, Forms, Leads, Pipeline, Team, Settings work identically on both tenants.
6. **Tenant isolation**: log entries as Zunkireelabs admin → log into a second Zunkireelabs user → can or can't see them per the role rules. Admizz can never see Zunkireelabs data anywhere.
7. **Schema sanity** (Phase 1): tables exist in DB, RLS policies enabled, indexes present.
8. **Rate snapshot integrity** (Phase 5): approve an entry, change the underlying rate, verify the entry's `rate_snapshot` does not change.
9. **Manifest still consistent**: `getFeatureAccess(IT_AGENCY, TIME_TRACKING) === true`, `getFeatureAccess(EDU, TIME_TRACKING) === false`, `getIndustrySidebarItems(IT_AGENCY)` includes Time Tracking entry.

If any check fails: Opus tells Sonnet what to fix; Sonnet iterates; Opus re-verifies.

---

## Out of scope (explicit non-goals)

- Invoice PDF generation or formal billing exports beyond CSV.
- Sheet-style grid view (multiple members per row, weekly grid bulk-entry).
- Time entry templates / recurring tasks.
- Live timer (start/stop button) — entries are typed retroactively, matching current workflow.
- Slack / external notifications on approval state changes.
- Per-task default rates (rates resolve project → member only).
- Multi-currency. One currency per tenant assumed.
- The "Att." column from the sheet — TBD what it means; out of scope until clarified.
- Mobile-optimized UI (responsive but no mobile-first redesign).
- Migration of existing Google Sheet data — manual entry only. CSV importer is a flagged v1.5 candidate.

---

## After v1 ships

- **Opus**: writes the SESSION-LOG entry, updates FEATURE-CATALOG, moves ROADMAP entry to "Recently shipped," `git mv docs/TIME-TRACKING-BRIEF.md docs/archive/features/time-tracking/PLAN.md`.
- **Sadin**: promotes `stage` → `main` for production rollout.
- **Next-up candidates** for IT-agency from the roadmap: Project Board, Service Catalog, Proposal Generator.

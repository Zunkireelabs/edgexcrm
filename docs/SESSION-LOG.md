# Lead Gen CRM — Session Log

> Single source of truth for cross-session continuity. Most recent milestone first.

**Project**: Multi-tenant Lead Gen CRM SaaS for Zunkiree Labs
**Status**: Phase 2A complete — verified and passing all 39 tests
**Live**: https://lead-crm.zunkireelabs.com
**Repo**: `Zunkireelabs/edgexcrm` (GitHub)

---

## 🟢 NEXT SESSION — RESUME HERE

- **Current state**: Accounts promotion shipped to `stage` (`13c528e`). Accounts is now a top-level CRM entity for it_agency (`/accounts/*` URLs, `FEATURES.ACCOUNTS` gate, `Building2` sidebar entry above Time Tracking). Time Tracking continues to own time entries + approvals only. Tabs branch was deleted (the framing pushback ruled). Phase 5 (rates + billable totals) is the next thing to ship.
- **Branch**: `stage` at `13c528e`. `main` (production) still on pre-industry-module version — recommend promoting after Phase 5 lands so prod gets a coherent Time Tracking v1 in one go.
- **Workflow split** (formalized 2026-05-25): Opus plans + reviews + pushes to stage. Sonnet executes on feature branches. Sonnet never pushes to stage. Local-verify-before-push. See `feedback_opus_plans_sonnet_executes` in memory.
- **Phase 5 plan** (next thing to ship): per-member `default_hourly_rate` (already on `tenant_users` from migration 020 — UI to manage it is what's missing), per-project `default_rate` override (new column on `projects`), `resolveEffectiveRate(entry, user, project)` helper, snapshot rate into `time_entries.rate_snapshot` on approval (column already exists from migration 020), billable totals column in the timesheet + a "This week billable" stats card. Brief details in `docs/TIME-TRACKING-BRIEF.md` § Phase 5. Estimated ~1 day.
- **What Opus does next**: write Sonnet handoff prompt for Phase 5, hand to Sadin, review when Sonnet reports back, smoke, merge.
- **Blockers**: none known.
- **Open items / questions**: see [STATUS-BOARD.md](./STATUS-BOARD.md).

When closing a session, push this block's content into a new dated session entry below, then refresh this block with the new current state.

---

## Accounts promotion shipped — top-level CRM entity for it_agency (2026-05-26)

### What was built

Accounts moved out from under `/time-tracking/accounts/*` to its own top-level sidebar entry + URL space + feature gate. The framing pivot from "Accounts is a Time Tracking sub-feature" → "Accounts is a CRM entity in its own right, parent to Projects" lands here. Time Tracking now owns only time entries + approvals.

- New feature: `FEATURES.ACCOUNTS = "accounts"` in `_registry.ts`. New folder `src/industries/it-agency/features/accounts/` with `meta.ts` + `pages/` + `components/`.
- Sidebar order on it_agency: Accounts (Building2) → Time Tracking (Clock). Building2 registered in `INDUSTRY_ICONS`.
- 6 `git mv`s preserved history: 2 page shells (`/accounts/page.tsx`, `/accounts/[id]/page.tsx`) + 2 industry pages (`accounts-list`, `account-detail`) + 2 components (`account-form`, `project-form`).
- 7 API routes (accounts + projects + tasks) re-gated from `FEATURES.TIME_TRACKING` → `FEATURES.ACCOUNTS`. Time-entry routes (`/api/v1/time-entries/*` including approve/reject) intentionally stay on `FEATURES.TIME_TRACKING` — time entries are a time-tracking concept, not an accounts concept.
- 2 intentional cross-feature imports introduced (architecturally correct, both documented):
  - `accounts/pages/account-detail.tsx` → imports `ProjectStatusBadge` from `time-tracking/components/status-badge` (badge has 4 other time-tracking consumers; promoting it to `_shared/` is a future cleanup).
  - `time-tracking/pages/project-detail.tsx` (stayed put) → imports `ProjectForm` from the new accounts location. Signals that project-detail is a candidate to migrate into accounts when account_id URL propagation gets sorted.
- 5 hardcoded `/time-tracking/accounts*` links rewritten to `/accounts*` across 3 page files (including project-detail's breadcrumb).
- `docs/FEATURE-CATALOG.md`: new ACCOUNTS row, TIME_TRACKING row corrected to its slimmer scope (3 routes, 5 API routes).
- Tabs work from prior session (`feature/time-tracking-nav-tabs` @ `96fcaae`) deleted — local + remote. The tabs implementation was clean but the framing was the issue, not the implementation.

### Workflow incident: Sonnet's commit was incomplete

Sonnet's initial commit `aefbe01` moved the 6 files and applied the obvious edits (API routes, registry, manifest, shell, FEATURE-CATALOG) but **omitted** the 4 page-file edits that lived on top of the moves (page-shell import paths + `FEATURES.TIME_TRACKING → FEATURES.ACCOUNTS` swap + cross-feature badge import + 3 link rewrites). Those existed as uncommitted working-tree edits.

Verifications passed anyway because Opus ran `npm run build`, `npm run lint`, and the grep checks against the working tree (which had the right content) and the manual smoke ran against the working tree's dev server too. The hole only surfaced at merge time when `git checkout stage` flagged the unstaged edits.

Fixed with an additive commit `13c528e` on the same branch (the project's "fix-back" pattern — same shape as Phase 4 fixback). Avoided amending so we didn't need to force-push a SHA origin already had.

**Lesson for next time**: when reviewing Sonnet's diff, `git status` should be the FIRST check, not just `git diff stage..feature`. If the working tree has uncommitted changes, the diff isn't representative of what's actually committed.

### Verification

- Build clean (`/accounts` + `/accounts/[id]` + 3 API routes present in route table).
- Lint 0 errors, 11 pre-existing warnings (none in touched files).
- Three grep invariants: no `/time-tracking/accounts` strings remain, `FEATURES.TIME_TRACKING` appears only in 4 time-entry routes, no stale `features/time-tracking/pages/account*` or `features/time-tracking/components/{account,project}-form` imports.
- Manual smoke as Zunkireelabs admin: sidebar shows Accounts (Building2), `/accounts` + `/accounts/<id>` work, `/time-tracking/accounts*` 404s, `/time-tracking` + `/time-tracking/projects/<id>` + `/time-tracking/approvals` unchanged. Project-detail back-link goes to `/accounts`. ✓
- Manual smoke as Admizz: no Accounts in sidebar, `/accounts` 404, `/api/v1/accounts` 403. ✓
- Stage deploy triggered on push of `13c528e`.

### Files Changed

- **New**: `src/industries/it-agency/features/accounts/meta.ts`.
- **Moved** (git mv, history preserved): 6 files into `/accounts/*` URL space + `features/accounts/` folder.
- **Modified**: `_registry.ts`, `it-agency/manifest.ts`, `shell.tsx`, 7 API routes, 3 page files (link + import rewrites), 2 page shells, `FEATURE-CATALOG.md`.
- **Deleted**: `feature/time-tracking-nav-tabs` branch (local + remote — commit `96fcaae` still in object DB if ever needed).
- **Archived**: `docs/ACCOUNTS-PROMOTION-BRIEF.md` → `docs/archive/features/`.
- **DB**: no changes.

### Not yet promoted to `main`

Still recommend promoting prod after Phase 5 ships, so Time Tracking lands in prod as a coherent v1.

---

## Time Tracking — Phases 4 + 4.5 shipped, Accounts-as-top-level decision (2026-05-25, evening)

### What was built

Two phases shipped in a single combined stage merge (`d252568`):

#### Phase 4 — Approvals queue + approve/reject API (commits `95bb3d1`, `9da8fe2`)

- Two new POST endpoints: `/api/v1/time-entries/[id]/approve` and `/api/v1/time-entries/[id]/reject`. Both run the full gate chain (auth → industry → `requireAdmin`) and return `INVALID_STATE` (409) if the entry isn't pending. Reject requires `{ reason: string, max 500 chars }`. Both emit audit logs + events.
- New `ApprovalsQueuePage` at `/time-tracking/approvals` with role gate, member/date grouping tabs, single-row approve/reject, bulk approve/bulk reject via `Promise.allSettled`, char-counted reject reason dialog.
- `TimeEntryRow` updated with `ApprovalStatusBadge` + tooltip on rejected entries' badges (shows reason on hover) + edit/delete hidden when `approval_status !== "pending"`.

#### Phase 4 fixback (commit `9da8fe2`) — Opus review found 3 issues

- **TOCTOU race**: approve/reject endpoints fetched status then updated only by `id`, so two admins could race. Fix: added `.eq("approval_status", "pending")` to the UPDATE chain + switched to `.maybeSingle()` — atomic precondition, 409 if 0 rows match.
- **Timezone bug regression**: approvals-queue.tsx used `.toISOString().split("T")[0]` in `fourWeeksAgo()` and `startOfWeek()` — same pattern that caused the Phase 3 bug. Fix: use `toLocalDateString()` from `@/lib/date`. The "This week: N pending" badge was off by a day in UTC+5:45.
- **Edit-lock UX**: home page's `entryCanEdit` was `if (isAdmin) return true`, meaning admins saw pencil/trash on approved/rejected entries. Sadin's call: "hide for everyone when locked" — `entryCanEdit = entry.approval_status === "pending"`.

#### Phase 4.5 — Role-aware team timesheet table (commit `d252568`)

- Replaced single-user card-list `/time-tracking` home with a role-aware **team timesheet**. Admin sees all members in one date-grouped table with Member column, filters (date range presets Today/This Week/This Month/Last 4w, Member admin-only, Account, Project, Status), per-row Approve/Reject inline buttons, and CSV export. Member sees own entries with no Member column and the existing inline `+ Log time` form pattern.
- Extended `/api/v1/time-entries` GET + POST select + the `[id]` GET/PATCH + approve + reject to nest `accounts(id, name)` under `projects(...)` — one round-trip resolves account names. `TimeEntryWithJoins` type updated.
- 7 new files: `pages/timesheet.tsx`, 5 components (`timesheet-filters`, `timesheet-stats-cards`, `timesheet-table`, `timesheet-row`, `log-time-dialog`), 1 shared hook (`use-approve-reject` extracted from approvals-queue so both surfaces share the same approve/reject + 409 handling).
- `approvals-queue.tsx` refactored to consume the shared hook for single approve/reject. Bulk operations kept as raw `Promise.allSettled` loops (Sonnet's judgment call — no benefit to routing them through the hook).
- Filter state synced to URL search params for shareable links + refresh survival.
- Route shell wrapped in `<Suspense>` (Next.js 16 requirement for `useSearchParams`).
- Member display: `email.split("@")[0]` (Phase 4 had `userId.slice(0, 8)` — resolved here).
- CSV export adapted from `leads-table.tsx` `exportCSV()` pattern. Headers + Member column conditional on role.

### Merge mechanics

- Branch `feature/time-tracking-phase-4` accumulated 3 commits (Phase 4, fixback, Phase 4.5).
- Stage moved forward to `f7430c2` while we were working (Anish's PR #10 — contacts page + lead types + tags-restricted-to-education). Required a rebase before ff-merge.
- Rebase was clean — stage and phase-4 touched no overlapping files in practice. Force-pushed with `--force-with-lease`.
- One coordination hiccup mid-session: Opus did a hard reset on local feature/time-tracking-phase-4 (back to origin) WITHOUT knowing Sonnet had a local-only commit. That orphaned Sonnet's `24efdda`. Recovered via `git reset --hard <orphaned-sha>` — commit object was still in the object DB so nothing was lost. Lesson: always verify origin has the latest before hard-reset.

### Accounts IA pivot (decision recorded — code not yet written)

After 4.5 shipped, Sadin flagged that **Accounts** (the entity, not just the page) was unreachable from the sidebar. Opus initially proposed Option A: add tabs under Time Tracking (Timesheet | Accounts | Approvals). Sonnet built it (`feature/time-tracking-nav-tabs` @ `96fcaae`) — clean implementation, faithful to spec.

**Sadin pushed back before merge**: "Accounts is a CRM-level entity, not a Time Tracking sub-feature. In every CRM (Salesforce, HubSpot, Pipedrive, Zoho) it's top-level. Why am I burying it?" Opus agreed — the original framing was wrong. The URL `/time-tracking/accounts` was already a tell.

**Decision locked**:
- Discard the tabs branch (not merging)
- Promote Accounts to top-level sidebar (it-agency only, since other industries don't model B2B accounts today)
- Move pages from `/time-tracking/accounts/*` to `/accounts/*`
- Introduce `FEATURES.ACCOUNTS = "accounts"` — separate from `FEATURES.TIME_TRACKING`
- Re-gate all accounts/projects/tasks API routes via `FEATURES.ACCOUNTS`
- Reorganize industry module: `src/industries/it-agency/features/accounts/` (separate from `time-tracking/`)
- `/time-tracking` becomes a single page (no tabs); Approvals stays at `/time-tracking/approvals` reached via the Pending stat tile (already linked)
- Project detail page stays at `/time-tracking/projects/[id]` for now (a future refactor could nest it under accounts but that needs account_id URL propagation — defer)

This is the next thing to ship before Phase 5.

### Verification done in-session

- Phase 4 fixback: build clean, lint unchanged, admin smoke verified single approve + single reject + char counter + tooltip + edit-lock + timezone-fix "This week" count. **Not** verified: bulk approve/reject, non-admin permission gate, Admizz 404/403, TOCTOU race two-window.
- Phase 4.5: build clean, lint unchanged, admin smoke verified the team table renders with all expected columns (Time/Member/Account/Project/Task/Notes/Status/Actions), account name resolves via nested join, member shows as email-prefix, status badges + edit-lock both render correctly. **Not** verified: non-admin member view, Admizz 404 on /time-tracking, CSV export contents.
- Tabs branch: build clean, lint unchanged. Not smoke-tested visually (decided to discard before merge).

### Files Changed (Phases 4 + 4.5)

- **New (Phase 4)**: 2 API route files (`time-entries/[id]/approve`, `/reject`), full real implementation of `approvals-queue.tsx`.
- **New (Phase 4.5)**: `pages/timesheet.tsx` + 5 components (`timesheet-{filters,stats-cards,table,row}`, `log-time-dialog`) + 1 hook (`use-approve-reject`).
- **Modified**: 4 time-entries API routes (extended select for accounts join), `use-time-entries.ts` type, `app/(main)/(dashboard)/time-tracking/page.tsx` (Suspense wrapper + new component import), `approvals-queue.tsx` (consume shared hook).
- **Deleted**: `pages/time-tracking-home.tsx` (replaced by `timesheet.tsx`).
- **DB**: no changes (schema from Phase 1 covers everything).

### Not yet promoted to `main`

`main` (production) is still on the pre-everything version. The right time to promote is after the Accounts refactor lands + Phase 5 (rates + billable) ships, giving production a coherent Time Tracking v1. Until then everything sits on staging.

---

## Time Tracking — Phases 1–3 shipped via Opus/Sonnet split (2026-05-25, afternoon)

### What Was Built

The first `it_agency`-scoped feature shipped, in three deployable phases. **Workflow split: Opus planned + reviewed + pushed to stage; Sonnet executed feature code on per-phase feature branches.** Each phase ended with: Sonnet pushes feature branch → Opus reviews diff → Opus runs build/lint → Sadin verifies locally on dev server → Opus merges ff-only into stage + pushes + deletes feature branch + watches deploy.

Brief: `docs/TIME-TRACKING-BRIEF.md` (370+ lines; locked the data model, API surface, UI surface, 5-phase plan, verification).

### Phase 1 — Schema + manifest scaffolding (commits `bea578c`, `5153087`)

- **Migration 020_time_tracking.sql** — created 4 tenant-owned tables (`accounts`, `projects`, `tasks`, `time_entries`), extended `tenant_users.default_hourly_rate` and `leads.account_id`. RLS policies per the brief: admin-only mutations on accounts/projects/tasks; time_entries is the exception (members SELECT all-in-tenant + INSERT/UPDATE own-pending; admins update any; DELETE admin-only at DB layer). Indexes (partial + composite) per brief. Applied to staging DB live via psql.
- **Trigger fix-back** (Opus caught it on review): Sonnet's initial migration missed `updated_at` triggers — every other tenant-owned table in the codebase has `trigger_<table>_updated_at BEFORE UPDATE ... EXECUTE FUNCTION update_updated_at()`. Sonnet amended the migration on the same branch (`5153087`). The `update_updated_at()` function already exists in the DB (verified pre-commit).
- **Manifest wiring**: `FEATURES.TIME_TRACKING = "time-tracking"` added to `_registry.ts`. `industries/it-agency/manifest.ts` populated with `timeTrackingMeta` + sidebar entry. `INDUSTRY_ICONS["Clock"]` registered in `shell.tsx`.
- **Five thin route shells** under `src/app/(main)/(dashboard)/time-tracking/{page.tsx, accounts/{page.tsx, [id]/page.tsx}, projects/[id]/page.tsx, approvals/page.tsx}` — each calls `getCurrentUserTenant → redirect/login → getFeatureAccess → notFound → delegate to industry page component`. Placeholder components rendered "Coming soon — Phase N".
- **Type system** extended in `src/types/database.ts` with `Account`, `Project`, `Task`, `TimeEntry`, `ProjectStatus`, `TaskStatus`, `ApprovalStatus` + `Lead.account_id` + `TenantUser.default_hourly_rate`.

### Phase 2 — Accounts + Projects + Tasks CRUD (commit `32b4615`)

- **7 API routes** under `src/app/(main)/api/v1/{accounts, projects, tasks}/...` — full CRUD for the three entity types. All routes: industry gate → admin gate (for mutations) → `scopedClient(auth)` → `validate()` body checks → audit log + event emission. `.update()` / `.delete()` chains `.eq("id", id)` per the wrapper's discipline rule. Project POST verifies the account belongs to this tenant via scopedClient before linking.
- **`AccountsListPage`** (`accounts-list.tsx`) — Card list with active/inactive indicator, project-count rollup batched via `.raw().in("account_id", [...])`. Empty state + admin gate on Create/Edit/Delete buttons.
- **`AccountDetailPage`** — account header, linked lead-contacts read-only list, projects list with inline create-project form.
- **`ProjectDetailPage`** — project header, tasks list with inline create + `TaskRow` edit-in-dialog + delete-with-confirm + hover-reveal action icons.
- **Components**: `AccountForm`, `ProjectForm`, `TaskRow`, `StatusBadge` (Project + Task + Approval variants). All shadcn-based.
- **Tenant isolation verified**: as Admizz, `/time-tracking/accounts*` → 404 and `/api/v1/accounts` etc. → 403. As Zunkireelabs IT, full CRUD works end-to-end.

### Phase 3 — Time entries log + list + edit + timezone fix (commits `b989d05`, `5dc4410`)

- **2 API routes** under `src/app/(main)/api/v1/time-entries/{route.ts, [id]/route.ts}`:
  - `GET /time-entries`: non-admins auto-scoped to own entries (`userIdParam = isAdmin ? param : auth.userId`). Filters: `project_id`, `approval_status`, `from`/`to` date range with regex validation. Returns entries with `projects(id, name, account_id), tasks(id, title)` joins.
  - `POST /time-entries`: server-side `user_id = auth.userId` (no impersonation). Verifies project belongs to tenant; if task_id given, verifies task belongs to project. `is_billable` denormalized from task (else project) at create time. `approval_status: 'pending'`, `rate_snapshot: null`.
  - `PATCH/DELETE /time-entries/[id]`: `canEdit(auth, entry)` helper — admin OR (own + pending). PATCH supports `entry_date`, `minutes`, `notes`, `project_id`, `task_id` (with cross-table validation when project/task changes).
- **`TimeTrackingHomePage`** (replaces the Phase 1 placeholder): "This week" total in header. Inline add form (not dialog — better UX for high-frequency use). Week-grouped → day-grouped → entries list with per-day totals. Collapsible Filters bar with Project / Date-range / Team-member (admin only) controls. Default 4-week window.
- **`TimeEntryAddForm`** — cascading Project → Tasks dropdown, single-project auto-select, minutes→hours live preview ("= 1h 30m"). Form resets keep project + date for quick repeat logging.
- **`TimeEntryRow`** — hover-reveal edit/delete icons; edit dialog allows minutes + notes only.
- **`use-time-entries` hook** — ISO-week grouping, optimistic CRUD callbacks, `JSON.stringify(filters)` dep stability.

**Timezone bug caught + fixed (commit `5dc4410`)**: Original code used `d.toISOString().split("T")[0]` for date-string conversion. In UTC+5:45 (Nepal), local midnight = 18:15 UTC the previous day → date strings shifted back by 1 → week labels read "WEEK OF MAY 17 – MAY 22" while containing Sunday May 24. **Fix**: new shared helper `src/lib/date.ts → toLocalDateString(d)` using `getFullYear/getMonth/getDate`; applied across `use-time-entries.ts`, `time-entry-add-form.tsx`, `time-tracking-home.tsx`. Data was always correct (DB stores `entry_date` as DATE; grouping was consistent across the bug); only the human-readable label was off.

### Verification per phase

Each phase: build clean → lint 0 errors → 3 successful staging deploys (`5153087` Phase 1, `32b4615` Phase 2, `5dc4410` Phase 3 with fix), all returning HTTP 200 on healthcheck. Manual UI: Sadin verified both as Zunkireelabs (IT) and Admizz (Education) for each phase. Tenant isolation confirmed at sidebar, route, and API level on every check.

### Workflow discipline that emerged

- **Branch sync precondition**: Sonnet branches from latest `stage` for each phase.
- **`scopedClient` discipline**: every new authenticated route uses `scopedClient(auth)`. The wrapper auto-injects tenant_id and strips it from update/insert payloads.
- **Local-verify-before-push** (added mid-Phase-1, formalized in Phase 2): Opus runs the dev server, Sadin verifies in browser, **then** Opus merges + pushes. Caught the timezone bug before it hit staging.
- **Fix-back loop**: when Opus catches an issue, Sonnet amends on the same feature branch (don't open a new branch per fix).
- **No Sonnet → stage**: Sonnet pushes feature branches only. Stage merge is Opus's gate.

### Files Changed (Phases 1–3 total)

- **New**: `supabase/migrations/020_time_tracking.sql`, `src/lib/date.ts` + `src/industries/it-agency/features/time-tracking/{meta.ts, pages/* (5), components/* (7), hooks/use-time-entries.ts}` + 9 API route files under `src/app/(main)/api/v1/{accounts, projects, tasks, time-entries}/...` + 5 thin page shells under `src/app/(main)/(dashboard)/time-tracking/`.
- **Modified**: `src/industries/_registry.ts` (add `TIME_TRACKING`), `src/industries/it-agency/manifest.ts` (populate features + sidebar), `src/components/dashboard/shell.tsx` (Clock icon registry), `src/types/database.ts` (Account/Project/Task/TimeEntry types + Lead.account_id + TenantUser.default_hourly_rate), `docs/FEATURE-CATALOG.md` (TIME_TRACKING row).
- **DB**: migration 020 applied live (4 tables + 4 triggers + 2 ALTERs + 7 indexes verified via psql).

### Open for Phase 4 (Sonnet currently working)

- 2 new endpoints (approve + reject)
- Real `ApprovalsQueuePage`
- Status badges on `TimeEntryRow`
- Hide edit/delete on locked entries
- Bulk-approve via `Promise.allSettled`

ETA ~0.5 day. Same review pattern.

### Open for Phase 5

Per-member default rates + per-project override + rate snapshot on approval + billable totals. The brief has the full spec. ~1 day estimate.

---

## Industry Modules — Hardening, Onboarding, First External Adaptation (2026-05-25)

### What Was Built

Continuation of the previous day's industry-module foundation work. Three distinct slices, all shipped to `origin/stage` and verified on staging.

#### 1. Code-review-driven hardening (commits `a4bfc81`, `8d9d438`)

Internal code review surfaced 15 findings on yesterday's foundation work. The most severe got fixed in this round; the rest documented for ongoing follow-up.

- **`a4bfc81` (RSC boundary fix)**: `SidebarItem.icon` was typed as `LucideIcon` (a React component). Server Components cannot pass non-serializable values to Client Components → dashboard crashed for education tenants. Changed to `icon: string` (name), with `INDUSTRY_ICONS` registry in `shell.tsx` resolving names to components on the client side.
- **`8d9d438` (security + correctness)**:
  - `scopedClient.update()` / `.insert()` now strip caller-supplied `tenant_id` via `stripTenantId()` helper — closes a cross-tenant-escape hole where a malicious or buggy caller could `update({ tenant_id: 'OTHER' })` to move rows between tenants.
  - `scopedClient.select()` accepts the `(columns, options)` overload so `count: "exact"` / `head: true` queries don't have to drop to `db.raw()` and lose tenant scoping.
  - New `db.fromGlobal(table)` escape for tables without `tenant_id` (auth.users, system tables).
  - `authenticateRequest()` now defensively handles both array and object shapes for the `tenants(industry_id)` embed — prevents a silent site-wide `industryId: null` if PostgREST's schema cache flips or the FK relationship is renamed.
  - `getManifest(null)` now falls back to `general` instead of returning null — legacy NULL-industry tenants are no longer locked out of every feature.
  - `getFeatureAccess()` / `getFeatureConfig()` `featureId` param tightened from `string` to `FeatureId` union — typos caught at compile time. Defense in depth: gate now also verifies `meta.industries.includes(industryId)` so a feature accidentally registered in the wrong manifest is rejected.
  - `getIndustrySidebarItems()` filters out items whose featureId isn't in the manifest's `features` array — catches sidebar/features drift inside a manifest.
  - Re-migrated notifications unread-count back through scopedClient (via the new options overload). Migrated team `DELETE` handler to scopedClient.
  - Documented `scopedClient.update()/.delete()` discipline rule loudly: caller MUST chain at least one additional filter, or the operation targets every row in the tenant.

Remaining ~33 legacy routes still on raw `createServiceClient()` + manual `.eq("tenant_id", ...)` — tracked on STATUS-BOARD as ongoing hardening.

#### 2. Onboarding & developer-facing docs (commits `38be5fe`, `4368244`)

- **`38be5fe` (migration playbook)**: new subsection in CLAUDE.md § Industry Scoping Rules — "Migrating an existing flat-pattern feature into the new structure." 10-step checklist covering branch sync, file moves, meta creation, manifest registration, replacing inline guards with the loader pattern, `scopedClient` adoption, and verification. Plus two "common pitfalls" callouts (icon-as-string for RSC boundary, scopedClient delete/update filter requirement).
- **`4368244` (architecture explainer)**: new `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` — visual ASCII diagrams comparing the old flat `src/features/<f>/` pattern vs the new `src/industries/<id>/features/<f>/` pattern. Covers directory layout, the 3-places gating problem the old pattern had, parallel-work merge conflicts on `shell.tsx`, the three feature categories (universal / industry-scoped / shared), the decision tree, and the scaling story at 2 / 5 / 20 industries. Linked from CLAUDE.md in two places (the top of Industry Scoping Rules + the "Read first, every session" list) so any new dev (human or Claude) lands on it before touching `src/industries/`.

The combined effect: a fresh Claude session on a clone gets `CLAUDE.md` auto-loaded → points to the architecture doc → which explains the *why* → and the rules section has the *what to do*. No tribal knowledge required.

#### 3. First external adaptation: Anish's `view-details` branch (commits `c64936e`, `b865cf0`, `41bddae`, `dccdb18`)

Anish pushed `origin/view-details` with 3 commits built against the OLD flat pattern (branched from `a627103`, before the industry-module work). Test of the migration playbook in practice.

- **Strategy**: created `adapt/view-details` off latest `origin/stage`, cherry-picked Anish's 3 commits, let git's rename detection port `src/components/dashboard/check-in-page.tsx` → `src/industries/education-consultancy/features/check-in/ui.tsx` automatically.
- **All 3 cherry-picks landed clean** — git auto-detected the rename and applied each diff to the new file location with zero manual conflict resolution. The migration playbook's claim (rename detection usually handles the move) was validated.
- **Features adapted**: View Details panel on check-in page (right-side panel with lead details + Check In button), Student/Parent tag system on leads (table column + filter + CSV export + API + check-in flow tag selector).
- **Schema drift caught and closed (commit `dccdb18`)**: Anish's "tags" feature added a `tags TEXT[]` column to `leads` directly via Supabase MCP without committing the migration file. Backfilled as `supabase/migrations/019_lead_tags.sql` with `IF NOT EXISTS` guards (no-op against the live DB but ensures fresh installs get the same schema).
- **Scope decision recorded**: Student/Parent labels are hardcoded education-specific for v1. Tag column on leads is universal infrastructure; if/when a 2nd industry wants tags, the tag UI promotes to `_shared/` with per-industry config (labels, colors). Not blocking — STATUS-BOARD follow-up.
- **Workflow**: adapter branch fast-forwarded into `stage`, branches cleaned up locally + remote (`adapt/view-details` and Anish's `view-details` both deleted).
- **Onboarding prompt for Anish** drafted in session — when he pulls `stage`, he reads `CLAUDE.md` + the architecture doc + the migration playbook before starting his next feature. His Claude gets the same context if he pastes the prompt as his first turn.

### Verification

All three slices landed via the same flow: build clean → push to stage → GitHub Actions auto-deploy → `https://dev-lead-crm.zunkireelabs.com/login` returned HTTP 200 each time. Three successful staging deploys today.

### Files Changed (high level)

- **Modified**: `CLAUDE.md` (migration playbook + architecture doc links), `src/lib/api/auth.ts` (defensive embed), `src/lib/supabase/scoped.ts` (security hardening + options overload + fromGlobal), `src/industries/_loader.ts` (general fallback + type tightening + sidebar filter), `src/components/dashboard/shell.tsx` (icon registry), `src/industries/_types.ts` (icon: string), `src/industries/education-consultancy/manifest.ts` (icon: string), `src/components/dashboard/leads-table.tsx` (tag column + filter + CSV), `src/types/database.ts` (Lead.tags), three leads API routes (accept tags), public submit route (default tag).
- **New (Anish's work, adapted)**: View Details panel + Student/Parent tag UI in `src/industries/education-consultancy/features/check-in/ui.tsx`.
- **New (infra/docs)**: `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`, `supabase/migrations/019_lead_tags.sql`.

### Carried Over to Production (`main`) — NOT yet

All of today's work is on `stage` only. Production deploy requires the standard `git checkout main && git merge stage && git push origin main` flow once staging verification is complete.

---

## Industry Modules — Path C Foundation + Hardening Rails (2026-05-24)

### What Was Built

The first-class industry module system. `industry_id` graduated from "decorative column that relabels things" to "architectural concept that gates features, drives sidebar, and reserves AI hook points." Anish's form-builder and the previously-universal student check-in were both migrated into the new `src/industries/education-consultancy/features/` home.

### Architecture (Path C)

```
src/
├── app/(main)/(dashboard)/          ← Universal features stay here (leads, pipeline, team, settings, dashboard)
├── components/dashboard/             ← Universal components
└── industries/                       ← NEW first-class concept
    ├── _registry.ts                    type-safe FEATURES + INDUSTRIES ID constants
    ├── _types.ts                       IndustryManifest, FeatureMeta, SidebarItem types
    ├── _loader.ts                      manifest reader + getFeatureAccess (the gate truth)
    ├── _shared/                        cross-industry shared features (empty stub today)
    ├── education-consultancy/
    │   ├── manifest.ts                  features + sidebar + AI config
    │   ├── features/
    │   │   ├── check-in/                MOVED from src/components/dashboard/check-in-page.tsx
    │   │   └── form-builder/            MOVED from src/features/form-builder/ (was Anish's flat-pattern home)
    │   └── ai/agent.ts                  AI config stub
    ├── it-agency/manifest.ts            empty stub (Sadin's territory)
    └── {construction,real-estate,healthcare,recruitment,general}/manifest.ts  empty stubs
```

### Decisions locked in during planning

- **Tenant model = A**: one tenant = one industry. Hybrid orgs run multiple tenants. Not multi-industry-per-tenant.
- **Path C**: industry modules for industry-scoped code; universal stays in `src/app/` and `src/components/dashboard/`. Two homes.
- **Gate strength = hide entirely**: sidebar item hidden, route 404, API 403. No upsell messaging for mismatched industry.
- **Refactor Anish's form-builder**: yes, brought into new structure as second inhabitant of `education-consultancy/features/`. Lead architect's call.
- **Promote, don't copy**: shared features move to `_shared/`; never copy-paste between industry folders.
- **Hardening = ongoing**: introduce `scopedClient(auth)` wrapper + migrate 2 routes as proof; ~35 legacy routes tracked for future migration on STATUS-BOARD.

### Files: new (15)

- `src/industries/_types.ts`
- `src/industries/_registry.ts`
- `src/industries/_loader.ts`
- `src/industries/_shared/README.md`
- `src/industries/education-consultancy/manifest.ts`
- `src/industries/education-consultancy/ai/agent.ts`
- `src/industries/education-consultancy/features/check-in/meta.ts`
- `src/industries/education-consultancy/features/form-builder/meta.ts`
- `src/industries/{it-agency,construction,real-estate,healthcare,recruitment,general}/manifest.ts` (6 stubs)
- `src/lib/industries/gate.ts` — `requireIndustry()` helper
- `src/lib/supabase/scoped.ts` — `scopedClient(auth)` wrapper
- `docs/INDUSTRY-MODULES-BRIEF.md` (in-flight; archived after this ships)
- `docs/FEATURE-CATALOG.md` — human-readable feature/industry catalogue

### Files: moved (with `git mv`, history preserved)

- 17 files from `src/features/form-builder/**` → `src/industries/education-consultancy/features/form-builder/**`
- `src/components/dashboard/check-in-page.tsx` → `src/industries/education-consultancy/features/check-in/ui.tsx`
- `src/components/dashboard/check-in-detail-page.tsx` → `src/industries/education-consultancy/features/check-in/detail-ui.tsx`

### Files: modified

- `CLAUDE.md` — major restructure. Replaced "Industry Feature Development" section with comprehensive Industry Scoping Rules. Added Tenant Isolation Rules + new feature checklist. Added scopedClient to Supabase Client Usage. Updated form-builder path. Updated Known Issues.
- `src/lib/api/auth.ts` — added `industryId: string | null` to `AuthContext`; `authenticateRequest()` now joins `tenants.industry_id`.
- `src/components/dashboard/shell.tsx` — dropped `BASE_NAV_ITEMS`/`EDUCATION_NAV_ITEMS` ternary; sidebar now reads `industrySidebarItems` prop merged with universal top/bottom items.
- `src/app/(main)/(dashboard)/layout.tsx` — threads `industrySidebarItems` from `getIndustrySidebarItems(industry_id)` into the shell.
- `src/app/(main)/(dashboard)/check-in/page.tsx` + `[id]/page.tsx` — thin shells: `getFeatureAccess()` → `notFound()`, delegate to UI in industry folder.
- `src/app/(main)/(dashboard)/forms/page.tsx`, `new/page.tsx`, `[id]/page.tsx` — same pattern; inline industry guards replaced with loader gate.
- 4 check-in API routes (`/api/v1/check-ins`, `/leads/check-in`, `/leads/[id]/check-in`, `/leads/[id]/check-ins`) — added `getFeatureAccess()` guard. Previously had **no industry gate at all** — IT-agency tenants could hit them.
- 3 form-config API routes (`/api/v1/form-configs`, `[id]`, `[id]/duplicate`) — added `getFeatureAccess()` guard. Page-level guard was already present; API-level was not.
- `src/app/(main)/api/v1/team/route.ts` (GET handler), `src/app/(main)/api/v1/notifications/route.ts` — migrated to `scopedClient(auth)` as proof of the hardening pattern.

### Why it matters

1. **Parallel multi-developer multi-industry work**: Sadin on `industries/it-agency/`, Anish on `industries/education-consultancy/` — zero shared-file conflicts. The old ternary in `shell.tsx` was the merge-conflict point of the previous pattern.
2. **Cross-industry feature sharing without duplication**: when a 2nd industry wants a feature, promote via `_shared/`, opt-in per manifest with per-industry config. The decision tree lives in CLAUDE.md.
3. **Single enforcement point**: `getFeatureAccess()` in `_loader.ts` is the truth. Change it once, sidebar/route/API all respect it.
4. **AI per-industry has a home now**: `industries/<id>/ai/agent.ts` slots are reserved. Future per-industry prompts/tools land there.
5. **Hardening: cross-tenant leaks one less risk**: `scopedClient(auth)` makes the tenant filter automatic. Two routes migrated, ~35 legacy routes documented for migration. Future routes default to the safe pattern.

### Verification

- `npm run build` — clean compile, all 43 routes generated, no errors.
- `npm run lint` — 8 warnings (all pre-existing or in unused-import line that was already present); 0 errors.

### Open items (now on STATUS-BOARD)

- Migrate remaining ~35 authenticated routes to `scopedClient(auth)`.
- Build actual per-industry AI prompts/tools (currently `agent.ts` stubs are empty).
- Wire `events` → webhook dispatcher (separate concern, not part of this work).
- First real industry-scoped feature for `it-agency` to validate the parallel-work claim end-to-end.

---

## Post-Phase 2A — Shipped Work Backfill (March–May 2026)

> **Discipline gap acknowledged**: between Phase 2A (Feb 21) and the doc reorg (May 24), shipped work landed without SESSION-LOG entries. This is a lightweight backfill written 2026-05-24 by reading PRs and commits — git log has the *what*, this entry captures the *why* before it decays. Detail is deliberately shallower than dedicated entries.

Shipped via PRs #4–#8 and direct-to-`stage` commits `f728ca8` → `b890c35`. Migrations `009`–`018` all landed in this window.

### Cluster 1 — Phase 2B-equivalent UI work (PRs #4–#7, April 9–10)

- **PR #4** (`3d08808`): User assignment UI on top of the Phase 2A backend. Four phases in one PR — invite flow with registration + token validation, bulk assign API + assign button + horizontal-scroll fix on the leads table, in-app notification dropdown with real-time polling, and Resend email notifications for invites and assignments (single + bulk).
- **PR #5** (`cf908aa`): Dashboard UI brought in line with the Zunkireelabs design system (the "agentic-commerce" reference). Table corners, pagination placement, per-page dropdown, sidebar/header polish.
- **PR #6** (`336dddc`): Truncated table cells with conditional tooltip (tooltip only fires when content is actually truncated, not always).
- **PR #7** (`7280831`): Bulk-action bar redesign with motion.

**Why**: The "Phase 2B" backlog from the Phase 2A entry (assignment UI, counselor-scoped view, invites UI) is now satisfied via these PRs. Treat that backlog as done unless you find a missing item in the lead-detail UI — `lead-detail.tsx` is the canonical place to check.

**Migrations from this window**: `015_notifications.sql` (in-app notification storage), plus design-system-driven schema tweaks `010`–`012`.

### Cluster 2 — Multi-pipeline + pipeline management (PR #8, April 12)

- **PR #8** (`a3e0ed2`, migration `016_multi_pipeline.sql`): Replaces the single-pipeline-per-tenant assumption from Phase 2A. New `pipelines` table; `pipeline_id` added to both `pipeline_stages` and `leads`; `terminal_type` (`won`/`lost`) on stages to distinguish conversion outcomes. New UI: `PipelineSelector` (pill dropdown), `PipelineSettingsModal`, `CreatePipelineModal` (default / copy / empty templates), `StageEditor` with drag-drop reorder. Selected pipeline persisted to `localStorage`.

**Why**: Phase 2A modeled pipeline as a flat list of stages per tenant. Multiple lead types (e.g., undergrad vs. post-grad consultancy flows) needed distinct stage sets — hence a `pipelines` layer above stages. **Anyone touching `pipeline_stages`, `stage_id` on leads, or the Kanban board must include `pipeline_id` in the model now.** Read migration 016 and `PipelineSelector.tsx` before editing.

Other migrations in adjacent commits: `009_multi_form_support` (multiple forms per tenant), `013_lead_insights` (AI insight scaffolding from the research dir — partial), `014_lead_activities` (timeline data model).

### Cluster 3 — Move-to-pipeline + email auto-forward + Gmail (`f728ca8`, May 4)

- `MoveToPipelineModal.tsx` (447 LOC) — drag-or-modal-driven moves between pipelines.
- Gmail OAuth per-tenant via `/api/v1/settings/email-accounts/gmail/auth` + `callback`; connected accounts stored in migration `018_connected_email_accounts.sql`.
- Email auto-forward rules (migration `017_email_forward_rules.sql`): tenant-defined rules that turn inbound emails into leads or routed messages. Manager UI: `email-rules-manager.tsx` (537 LOC). Send via `smtp-sender.ts`, forwarding logic in `email-forward.ts`.
- AI chat route stub `/api/v1/ai/chat` — entry point for the AI orchestration work the `archive/research/ai-insight-*` docs sketched.
- **Route group restructure**: API routes moved under `src/app/(main)/api/...` to share a `(main)` layout with dashboard pages. **If a route 404s after this commit, check whether it should live under `(main)/`.**

**Why**: Email is the second inbound channel for leads after public forms — particularly for education consultancies that already field inquiries via Gmail. The Gmail connection is per-tenant (OAuth), not app-level. The AI chat route was scaffolded here but its real implementation is downstream.

### Cluster 4 — Student check-in system (`974d1b0`, May 5)

- New top-level dashboard route `/check-in` with search, history list, and per-student detail page.
- API: `/api/v1/check-ins` (list), `/api/v1/leads/[id]/check-in[s]` (record + list per lead).
- Components: `check-in-page.tsx` (696 LOC), `check-in-detail-page.tsx`, sidebar link in `shell.tsx`.

**Why**: First vertical-specific feature — education consultancies running physical events / counselling sessions need to mark that a lead showed up, with timestamp + history. **Not gated by tenant type**, so it shows for every tenant. If onboarding a non-education vertical, consider a feature flag.

### Cluster 5 — Phone country-code work (`38aa1b9`, `816153e`, `3d7386f`, `b890c35`, May 13–18)

- New `phone-input.tsx` (country-code selector + number input) used on public form, add-lead sheet, lead detail, and check-in flows.
- New libs: `country-codes.ts` (dial code table), `phone-utils.ts` (parse/format helpers — `formatPhoneWithCountryCode()` is the canonical formatter).
- Two follow-up fixes (`3d7386f`, `b890c35`): country code kept getting dropped on partial form submissions and on API-created leads — fixed in form component and in the leads POST handler.
- Side feature (`816153e`): lead source column now visible in leads table + CSV export.

**Why**: International applicants — Indian consultancies handling leads from multiple countries needed country code as part of identity, not cosmetics. The two fixes show how easy it is to lose the country code along submission paths: **always route phone fields through `formatPhoneWithCountryCode()` in `phone-utils.ts` rather than concatenating raw strings.**

### What this entry deliberately does NOT cover

- Per-migration deep-dives for `009`–`018` — read the SQL directly if working on schema. The clusters above name the migrations relevant to each.
- **PR #9** ("form builder for education consultancy", merged 2026-05-21, commit `7afa0e7`) — landed *after* the window above and is not yet on `stage`'s 7-commit lag. Needs its own entry once current state is verified.
- The 3 unmerged local-only commits — minor ci + style fixes; will resolve on next push/rebase.

### Files Changed (summary)

PRs #4–#8 + direct commits `f728ca8` → `b890c35`. Highlights:
- **New components**: `MoveToPipelineModal`, `email-rules-manager`, `check-in-page`, `check-in-detail-page`, `phone-input`, `PipelineSelector`, `PipelineSettingsModal`, `CreatePipelineModal`, `StageEditor`, bulk action bar
- **New libs**: `email-forward`, `smtp-sender`, `country-codes`, `phone-utils`
- **New API routes**: `pipelines/*`, `pipelines/[id]/stages/*`, `ai/chat`, `settings/email-accounts/*`, `settings/email-rules/*`, `check-ins/*`, `leads/[id]/check-in[s]`, bulk-assign, invites accept/registration
- **Migrations**: `009_multi_form_support` → `018_connected_email_accounts` (10 migrations)

---

## Phase 2A — SaaS Operational Layer (February 21, 2026)

### What Was Built

Built the full operational layer: lead assignment, counselor role, dual-mode pipeline stages, invite system, checklists, and intake tracking. All backend/API — no UI changes (that's Phase 2B).

#### 1. Database Migration (`003_phase2a_saas_ops.sql`)
- **`stage_id`** on leads — FK to `pipeline_stages`, backfilled from `status` slug for all 10 existing leads
- **`assigned_to`** on leads — FK to `auth.users`, indexed where `deleted_at IS NULL`
- **Intake fields** — `intake_source`, `intake_medium`, `intake_campaign`, `preferred_contact_method`
- **Counselor role** — expanded `tenant_users` check constraint to include `'counselor'`
- **`invite_tokens` table** — email, role, token, expiry, RLS for admin-only SELECT
- **`lead_checklists` table** — per-lead checklist items with position, completion tracking, RLS for tenant members
- **`get_user_tenant_role()`** — SECURITY DEFINER helper function

#### 2. Type System Updates (`src/types/database.ts`)
- `UserRole` union: added `"counselor"`
- `Lead.status`: changed from `LeadStatus` to `string` (pipeline stages are dynamic)
- `Lead` interface: added `stage_id`, `assigned_to`, intake fields
- New interfaces: `InviteToken`, `LeadChecklist`
- `LeadStatus` type kept for backward compat (dashboard color maps)

#### 3. Auth Layer (`src/lib/api/auth.ts`)
- **`authenticateUser()`** — lightweight JWT-only auth, no tenant required (for invite accept flow)
- **`requireLeadAccess(auth, lead)`** — admin OR (counselor AND assigned_to match)
- **`isCounselorOrAbove(auth)`** — owner, admin, or counselor (distinguishes from viewer)

#### 4. Validation (`src/lib/api/validation.ts`)
- **`optionalMaxLength(n)`** — returns null if empty, else checks length

#### 5. Queries (`src/lib/supabase/queries.ts`)
- `getCurrentUserTenant()` — now returns `userId` alongside tenant/role
- `getLeads()` — accepts optional `{ role, userId }` for counselor scoping
- `getLead()` — same counselor scoping
- `getLeadChecklists()` — new, ordered by position

#### 6. Updated Leads API (`src/app/api/v1/leads/`)

**GET /api/v1/leads**:
- `assigned_to` query param filter
- Counselor auto-scoping: forces `assigned_to = auth.userId`

**POST /api/v1/leads**:
- Accepts intake fields
- Always resolves `stage_id` from status slug — rejects 422 if no matching stage
- No lead can be created with `stage_id = NULL`

**GET /api/v1/leads/[id]**:
- Counselor scoping: 404 if not assigned

**PATCH /api/v1/leads/[id]**:
- Access: `requireLeadAccess()` replaces `requireAdmin()`
- `ADMIN_ONLY_FIELDS = ["assigned_to"]` — counselor submitting → 403
- Dual-mode stage resolution:
  - `status` only → resolves `stage_id` from pipeline_stages
  - `stage_id` only → resolves `status` slug from pipeline_stages
  - Both → 422
- `assigned_to` validation: must be tenant member, checked on every PATCH
- Emits `lead.assigned` event on assignment change

**DELETE**: unchanged (admin only)

#### 7. Invite API (`src/app/api/v1/invites/`)

**POST /api/v1/invites** (admin only):
- Creates invite with 7-day expiry, crypto.randomUUID() token
- Checks: no existing member, no pending invite for same email

**GET /api/v1/invites** (admin only):
- Returns pending (unaccepted, unexpired) invites

**POST /api/v1/invites/accept** (authenticated, no tenant required):
- Uses `authenticateUser()` — user may not have a tenant yet
- Validates: token exists, not expired, email matches JWT, not already member
- Creates `tenant_users` record, marks invite accepted

**DELETE /api/v1/invites/[id]** (admin only):
- Hard deletes invite

#### 8. Checklist API (`src/app/api/v1/leads/[id]/checklists/`)

**GET** (lead-access scoped):
- Returns checklists ordered by position
- 404 if lead is soft-deleted

**POST** (admin only):
- Creates checklist item with title, position

**PATCH /checklists/[checklistId]** (lead-access scoped):
- Counselor: can only toggle `is_completed`
- Admin: can also update `title`, `position`
- Auto-sets `completed_at`/`completed_by` on completion, clears on uncompletion

**DELETE** (admin only):
- Hard deletes checklist item

#### 9. Dashboard Pages
- `dashboard/page.tsx`, `leads/page.tsx`, `leads/[id]/page.tsx` — pass `role`/`userId` for counselor scoping
- `lead-detail.tsx`, `leads-table.tsx` — fixed `statusColors` typing from `Record<LeadStatus, string>` to `Record<string, string>` for dynamic stages

### Verification Results — 39/39 PASS

| Section | Tests | Result |
|---------|-------|--------|
| Migration | 7 | ✅ All pass — backfill, tables, RLS, constraints, function |
| Counselor Isolation | 5 | ✅ All pass — B can't see/get/patch A's leads, A can, admin sees all |
| Assignment Validation | 3 | ✅ All pass — non-member→422, viewer→allowed, counselor reassign→403 |
| Invite Flow | 5 | ✅ All pass — create, accept, re-accept→422, expired→422, existing member→409 |
| Checklist Security | 7 | ✅ All pass — admin create, counselor toggle, counselor can't edit title, viewer blocked, soft-delete→404 |
| Stage Integrity | 5 | ✅ All pass — invalid stage→422, invalid slug→422, both→422, 5 transitions consistent, stage_id→status |
| Regression | 5 | ✅ All pass — public form, rate limiting, audit logs, events, intake fields |
| Build | 3 | ✅ All pass — npm build, no TS warnings, Docker build |

### Files Changed

**New (7):**
- `supabase/migrations/003_phase2a_saas_ops.sql`
- `src/app/api/v1/invites/route.ts`
- `src/app/api/v1/invites/accept/route.ts`
- `src/app/api/v1/invites/[id]/route.ts`
- `src/app/api/v1/leads/[id]/checklists/route.ts`
- `src/app/api/v1/leads/[id]/checklists/[checklistId]/route.ts`
- `scripts/verify-phase2a.sh` (test script)

**Modified (9):**
- `src/types/database.ts`
- `src/lib/api/auth.ts`
- `src/lib/api/validation.ts`
- `src/lib/supabase/queries.ts`
- `src/app/api/v1/leads/route.ts`
- `src/app/api/v1/leads/[id]/route.ts`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/leads/page.tsx`
- `src/app/(dashboard)/leads/[id]/page.tsx`
- `src/components/dashboard/lead-detail.tsx`
- `src/components/dashboard/leads-table.tsx`

### Design Decisions

1. **`assigned_to` allows any tenant member (including viewer)** — assignment is informational tracking, not access control. A viewer assigned to a lead can see it but can't modify it.
2. **Counselor gets 403 on PATCH (not 404)** when trying to update non-assigned lead fields — the lead exists (they passed access check for the lead itself), but the specific field is admin-only.
3. **`authenticateUser()` is separate from `authenticateRequest()`** — invite accept flow needs JWT validation without tenant membership (user has no tenant yet).
4. **Hard delete for invites and checklists** — these are operational data, not business records. No soft-delete needed.
5. **`stage_id` always resolved on POST** — enforces pipeline integrity from day one. No NULL `stage_id` on any new lead.

---

## Phase 1.5 — API-First Architecture (February 20–21, 2026)

### What Was Built
- RESTful API routes at `/api/v1/leads` and `/api/v1/leads/[id]` with full CRUD
- Pagination, search, status filter on GET
- Idempotency key support on POST (prevents duplicate leads)
- Soft deletes (`deleted_at` column) instead of hard deletes
- Audit trail (`audit_logs` table) — logs all mutations with changes diff
- Event system (`events` table) — emits `lead.created`, `lead.updated`, `lead.status_changed`, `lead.deleted`
- Pipeline stages (`pipeline_stages` table) — configurable per tenant, seeded with 5 defaults
- Status validation against pipeline stages (PATCH rejects invalid status slugs)
- Rate limiting on public form POST (in-memory, per tenant+IP)
- Structured logging via pino
- API response helpers (apiSuccess, apiError, apiPaginated, etc.)
- Request authentication via Supabase SSR cookies

### Migration: `002_phase1_5_foundation.sql`
- Added `deleted_at`, `idempotency_key` to leads
- Created `audit_logs`, `events`, `pipeline_stages` tables
- Seeded 5 default stages per tenant: new, partial, contacted, enrolled, rejected
- RLS on all new tables

---

## Phase 1 — Initial Build (February 20, 2026)

### What Was Built
Converted the single-client RKU scholarship lead system into a scalable multi-tenant SaaS product.

### Source Project
- **Location**: `/home/zunkireelabs/devprojects/hardik-dev-space/rku-dev/rku-form-prep/`
- **What it was**: Static HTML/JS scholarship form + admin dashboard for RK University
- **Backend**: Supabase (project ref: `ldsgsdjixzsljgkcktqu`)
- **Dashboard**: `leads-admin.zunkireelabs.com` (still running on Docker)

### Architecture
- Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui
- Supabase (PostgreSQL + Auth + Storage)
- Docker + Traefik deployment
- 5 tables with RLS using SECURITY DEFINER functions
- Dynamic multi-step public forms rendered from JSONB config
- Dashboard with stats, leads table, lead detail, settings

### Issues Fixed
1. **Docker SIGBUS** — .dockerignore + Node 22 + increased memory
2. **DNS mismatch** — `lead-crm` vs `leads-crm`
3. **Healthcheck** — `wget` to `127.0.0.1` instead of `localhost`
4. **RLS infinite recursion** — SECURITY DEFINER functions
5. **Public form 404** — anon SELECT policy on tenants
6. **Dashboard redirect loop** — show error instead of redirect

---

## What's NOT Built Yet

### Phase 2B (Next — UI for Phase 2A features)
- [ ] Invite management UI in Settings
- [ ] Lead assignment UI (dropdown in lead detail)
- [ ] Counselor-scoped dashboard view
- [ ] Checklist UI in lead detail
- [ ] Pipeline stage editor UI
- [ ] Intake source display in lead detail

### Future Phases
- [ ] User registration page
- [ ] Form field editor in Settings UI
- [ ] Tenant creation UI
- [ ] User management page
- [ ] Lead pagination / infinite scroll
- [ ] Lead sorting by column
- [ ] Lead import (CSV upload)
- [ ] Email notifications on new lead
- [ ] Webhook integrations
- [ ] Dark mode toggle
- [ ] Multi-form support per tenant
- [ ] Form analytics / conversion tracking

### Technical Debt
- [ ] Next.js 16 middleware → proxy migration (deprecation warning)
- [ ] Better error boundaries
- [ ] Loading skeletons
- [ ] Unit tests
- [ ] E2E tests (Playwright)
- [ ] CI/CD pipeline
- [ ] CSRF protection review

---

## File Reference

### Key Files to Read First
1. `CLAUDE.md` — project overview (loaded into system prompt)
2. `src/types/database.ts` — all TypeScript types
3. `supabase/migrations/001_initial_schema.sql` — base schema + RLS
4. `supabase/migrations/002_phase1_5_foundation.sql` — audit, events, pipeline
5. `supabase/migrations/003_phase2a_saas_ops.sql` — assignment, invites, checklists
6. `src/lib/api/auth.ts` — authentication + authorization helpers
7. `src/lib/supabase/queries.ts` — server-side data fetching
8. `src/app/api/v1/leads/route.ts` — leads API
9. `src/components/form/public-form.tsx` — dynamic form renderer
10. `docker-compose.yml` — deployment config

### Config Files
- `.env.local` — Supabase URL, keys, app URL (DO NOT COMMIT)
- `.mcp.json` — Supabase MCP connection string (DO NOT COMMIT)
- `next.config.ts` — standalone output, Supabase image domains
- `docker-compose.yml` — Traefik labels for `lead-crm.zunkireelabs.com`

---

## Deployment Steps

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm

# Rebuild and restart
docker compose up -d --build

# Check status
docker ps --filter name=leads-crm
docker logs leads-crm

# Run migration (if DB changes)
PGPASSWORD='H2a0r0d0ik#' psql "postgresql://postgres.pirhnklvtjjpuvbvibxf@aws-1-ap-south-1.pooler.supabase.com:5432/postgres" -f supabase/migrations/003_phase2a_saas_ops.sql
```

---

## Adding a New Client (Tenant)

```sql
-- 1. Create tenant
INSERT INTO tenants (name, slug, primary_color, config)
VALUES ('Client Name', 'client-slug', '#1a73e8', '{}');

-- 2. Create Supabase auth user (via API or dashboard)
-- Then link them:
INSERT INTO tenant_users (tenant_id, user_id, role)
VALUES ('<tenant-id>', '<auth-user-id>', 'owner');

-- 3. Create form config
INSERT INTO form_configs (tenant_id, name, is_active, branding, steps)
VALUES ('<tenant-id>', 'Lead Form', true,
  '{"title": "Apply Now", "primary_color": "#1a73e8"}'::jsonb,
  '[{"title": "Contact Info", "fields": [...]}]'::jsonb
);

-- 4. Pipeline stages auto-seeded (trigger in 002 migration)
-- 5. Form is live at: https://lead-crm.zunkireelabs.com/form/client-slug
```

### Adding a User via Invite (Phase 2A)

```bash
# Admin creates invite via API
curl -X POST https://lead-crm.zunkireelabs.com/api/v1/invites \
  -H "Content-Type: application/json" \
  -H "Cookie: <admin-session-cookie>" \
  -d '{"email":"user@example.com","role":"counselor"}'

# Response includes token — share with user
# User signs up in Supabase, then accepts:
curl -X POST https://lead-crm.zunkireelabs.com/api/v1/invites/accept \
  -H "Content-Type: application/json" \
  -H "Cookie: <user-session-cookie>" \
  -d '{"token":"<invite-token>"}'
```

# HRMS Phase 1 — People & Resourcing — BUILD BRIEF (for Sonnet)

**Author:** Opus (planner). **Executor:** Sonnet. **Test tenant:** Zunkiree Labs (`zunkireelabs-crm`, `it_agency`). **Approved roadmap:** `~/.claude/plans/today-lets-work-on-spicy-phoenix.md`.

Read `CLAUDE.md` (Industry Scoping Rules, Tenant Isolation Rules, Migration workflow) and `docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md` before starting.

---

## 🛑 GUARDRAILS — read first, non-negotiable

1. **Branch only. Do NOT merge.** Work on `feature/hrms-phase-1-people-resourcing` off `stage`. Open a PR to `stage` but **do not merge it** — Opus reviews first.
2. **Do NOT touch prod DB (`pirhnklvtjjpuvbvibxf`).** Not now, not at all in this phase.
3. **Write migration files but do NOT apply them to any database yourself.** Opus applies to stage (`dymeudcddasqpomfpjvt`) after review. Deliver the `.sql` files only.
4. **Stop at the review gate.** After the build + local verification, produce a report and stop. No self-merge, no deploy, no prod.
5. **Reuse the spine — no parallel `employees` identity.** The employee IS a `tenant_users` row. Every new table extends it.
6. Every tenant-owned table: `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` + RLS using `get_user_tenant_ids()` (SELECT) and `is_tenant_admin(tenant_id)` (mutations). New API routes use `scopedClient(auth)`.
7. Build chunk-by-chunk in the order below; each chunk must `npm run build` clean before the next.

---

## Scope of Phase 1

**Universal core (Global, all tenants):** employee profile (extends `tenant_users`), departments, skills + employee-skills, a People directory page.
**it_agency edge (industry-scoped):** Resourcing (allocate people to projects), Utilization/Bench board, Skills matrix — plugs into existing `projects` / `time_entries`.

Out of scope (later phases): leave, attendance, onboarding, performance, payroll, the AI agent layer. Leave a documented seam for utilization to later subtract leave, but do not build it.

---

## CHUNK A — Database (migrations + RLS)  ·  domain: `/db-engineer`

Create additive migration files in `supabase/migrations/`, next numbers after `111` → **112, 113, 114**. All in a transaction, additive-only, with before/after count comments. **Do not apply them.**

### `112_employee_profiles.sql`
- **`departments`** — `id, tenant_id FK, name TEXT NOT NULL, lead_tenant_user_id UUID REFERENCES tenant_users(id) NULL, created_at`. `UNIQUE(tenant_id, name)`.
  - *Rationale (do not "reuse" org_layers):* `org_layers` are vertical RBAC tiers bound to `positions`; departments are functional groupings independent of the permission hierarchy. Distinct concept → new table.
- **`employee_profiles`** — 1:1 extension of a membership, `tenant_user_id UUID NOT NULL UNIQUE REFERENCES tenant_users(id) ON DELETE CASCADE`, `tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`. Columns:
  - `employment_type TEXT CHECK (employment_type IN ('full_time','part_time','contractor','intern'))`
  - `employment_status TEXT NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','on_leave','notice','terminated'))`
  - `billable BOOLEAN NOT NULL DEFAULT true`
  - `weekly_capacity_hours NUMERIC NOT NULL DEFAULT 40`
  - `job_title TEXT`, `hire_date DATE`, `date_of_birth DATE`, `phone TEXT`, `address TEXT`
  - `photo_url TEXT` (path in a **private** bucket; see Chunk D-privacy), `emergency_contact JSONB`
  - `department_id UUID REFERENCES departments(id) ON DELETE SET NULL`
  - `manager_tenant_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL` (reporting line)
  - `created_at, updated_at`
  - **Do NOT add a pay column** — pay stays on `tenant_users.default_hourly_rate`.
- RLS on both: SELECT via `tenant_id = ANY(get_user_tenant_ids())`; INSERT/UPDATE/DELETE via `is_tenant_admin(tenant_id)`. (Finer self-service/manager read-scoping is enforced in the API layer in Chunk C, consistent with how leads scoping works today; RLS stays tenant-coarse + admin-mutations, matching existing tables.)

### `113_skills.sql`
- **`skills`** — `id, tenant_id FK, name TEXT NOT NULL, category TEXT, created_at`. `UNIQUE(tenant_id, name)`.
- **`employee_skills`** — `id, tenant_id FK, tenant_user_id FK, skill_id FK, proficiency SMALLINT CHECK (proficiency BETWEEN 1 AND 5), years NUMERIC, created_at`. `UNIQUE(tenant_user_id, skill_id)`.
- RLS: SELECT tenant-coarse; mutations `is_tenant_admin`.
- **Seed** skill categories for `it_agency` tenants aligned to the Service Catalog: `Web Development, Mobile, UI/UX, Cloud & DevOps, AI/ML, Digital Marketing`. Seed the *categories* (as a handful of starter skill rows or a category list) `WHERE tenant_id IN (SELECT id FROM tenants WHERE industry_id = 'it_agency')` — mirror the seeding style of `046_deals.sql`.

### `114_project_allocations.sql`
- **`project_allocations`** — `id, tenant_id FK, project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, tenant_user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE, hours_per_week NUMERIC NOT NULL, role_on_project TEXT, start_date DATE, end_date DATE, created_at`. Index on `(tenant_id, project_id)` and `(tenant_id, tenant_user_id)`.
  - Store `hours_per_week` (robust to capacity changes); UI derives `% = hours_per_week / weekly_capacity_hours`.
- RLS: SELECT tenant-coarse; mutations `is_tenant_admin`.

**Acceptance:** files parse; a dry `psql --dry` / local scratch DB apply succeeds (your local only, never stage/prod); before/after counts documented in comments.

---

## CHUNK B — Permissions extension  ·  domain: `/api-dev` + `/db-engineer`

Extend the existing RBAC blob in `src/lib/api/permissions.ts` — **do not build a parallel system**. Follow the exact pattern used for `canManageApplications` / `canManageClasses`:
- Add `canManageHR?: boolean` to `PositionPermissions` and its resolved form on `ResolvedPermissions`.
- Wire into `resolvePermissions()` (owner/admin hard-override → true) and `validatePositionPermissions()`.
- Add a helper `canManageHR(permissions)` mirroring `canEditApplication` etc.
- Surface the toggle in the positions editor UI (`src/components/dashboard/settings/positions-manager.tsx`) next to the other `canManage*` switches.

**Self-service default (no `canManageHR`):** an employee reads/edits **their own** `employee_profiles` row; a manager reads their **direct reports** (rows where `manager_tenant_user_id` = the manager's `tenant_users.id`). Enforced in Chunk C API, not RLS.

**Acceptance:** typecheck clean; existing positions unaffected (additive optional field); owner/admin still full-access.

---

## CHUNK C — API routes  ·  domain: `/api-dev`

All routes: `authenticateRequest()` → (industry-edge routes also) `getFeatureAccess(auth.industryId, FEATURES.RESOURCING) → apiForbidden()` → `scopedClient(auth)` → response helpers from `src/lib/api/response.ts`. Names via `db.raw().auth.admin.listUsers()` stitch (same as `team/route.ts`).

**Core (universal):**
- `src/app/(main)/api/v1/employees/route.ts` — GET roster (join `tenant_users` + `employee_profiles` + stitched name/email); POST/PATCH profile. **Scope:** `canManageHR` or owner/admin → all; else caller may read/write only own row; managers may read direct reports. Mirror the counselor self-scoping pattern (`shouldRestrictToSelf`).
- `src/app/(main)/api/v1/employees/[id]/route.ts` — GET/PATCH one profile, same scope rules.
- `src/app/(main)/api/v1/departments/route.ts` (+ `[id]`) — CRUD, `canManageHR`/admin only.
- `src/app/(main)/api/v1/skills/route.ts` (+ `[id]`) — catalog CRUD (admin/HR); `src/app/(main)/api/v1/employees/[id]/skills/route.ts` — attach/detach `employee_skills`.

**it_agency edge (gate on `FEATURES.RESOURCING`):**
- `src/app/(main)/api/v1/project-allocations/route.ts` (+ `[id]`) — CRUD allocations; admin/HR or project owner may allocate.
- `src/app/(main)/api/v1/resourcing/utilization/route.ts` — GET utilization per member: reuse the existing time summary (`/api/v1/time-entries/summary?dimension=member`, approved+billable minutes) as numerator, `weekly_capacity_hours` as denominator; return per-member `{ billableHours, capacityHours, utilizationPct, allocations[] }`. **Seam:** add a `// Phase 2: subtract approved leave from capacityHours` comment where the denominator is computed.

**Acceptance:** each route returns 200 for an authorized it_agency user, 403 for a non-it_agency tenant on the edge routes, and self-scoping verified (a plain member cannot read another member's profile).

---

## CHUNK D — Registry, manifest, sidebar wiring  ·  domain: `/frontend-dev`

1. `src/industries/_registry.ts` — add `RESOURCING: "resourcing"` (and, if you split them, `HR_PEOPLE` etc.) to `FEATURES`.
2. `src/industries/it-agency/features/resourcing/meta.ts` — `{ id: FEATURES.RESOURCING, industries: [INDUSTRIES.IT_AGENCY] }`.
3. `src/industries/it-agency/manifest.ts` — push `{ meta: resourcingMeta }` onto `features[]`; add sidebar items into the **"Organization"** section of the `isItAgency` hardcoded branch in `src/components/dashboard/shell.tsx` (~lines 480–560): **People** (`/people`, universal — visible to all but lives in Org section here), **Resourcing** (`/resourcing`), **Utilization** (`/resourcing/utilization`). Register any new Lucide icon name in `INDUSTRY_ICONS` (e.g. `Users`, `Gauge`).

**Acceptance:** sidebar shows the new items for Zunkiree Labs; hidden/404 for Admizz.

---

## CHUNK D-UI — Pages & components  ·  domain: `/frontend-dev` + `/ui-ux-expert`

- **Core People directory** — `src/app/(main)/(dashboard)/people/page.tsx` (Server Component shell: auth + fetch) → `src/components/dashboard/hr/people-directory.tsx`. Table of members with profile fields, edit drawer, skills chips. Reuse existing team/settings component idioms.
- **it_agency Resourcing** — `src/industries/it-agency/features/resourcing/{pages,components,hooks,lib}`:
  - Route shells `src/app/(main)/(dashboard)/resourcing/page.tsx` + `resourcing/utilization/page.tsx`, each gating `getFeatureAccess(tenant.industry_id, FEATURES.RESOURCING) → notFound()`.
  - **Resourcing board** — evolve `src/industries/it-agency/features/project-board/components/views/members-view.tsx` into an allocation view: per member show allocated projects (hours/week), capacity, and open bench. Allocate/edit via `project-allocations` API.
  - **Utilization dashboard** — per-member billable-utilization bars off the utilization API; flag under- and over-utilized; a **Bench** list (members with 0 active allocations).
  - **Skills matrix** — grid of members × skills with proficiency.

### Privacy (mandatory)
- Profile photos / any HR documents go in a **private Supabase bucket** (mirror the consent-PDF private-bucket pattern — grep `consent` for the precedent). Never a public bucket. Serve via signed URLs. `security-auditor` must review before the PR is considered done.

---

## Verification (run locally before reporting — do not skip)

1. `npm run dev`, log in as `admin@zunkireelabs.com` / `edgexdev123` (stage clone). Create a department, an employee profile, add skills, allocate a member to a project, open the utilization board and confirm it reads real `time_entries`.
2. **Isolation:** log in as an Admizz user (`hello@admizz.org` / `edgexdev123`) → `/resourcing` and `/resourcing/utilization` **404**, edge sidebar items hidden; `/people` core still works.
3. **Permissions under a REAL session (not service-role):** a member position without `canManageHR` can read only their own profile; a manager sees direct reports; `canManageHR` sees all. Reset a stage user's password via the Admin API to get a JWT and query as them (per `feedback_verify_rls_paths_under_real_session`).
4. Gates: `npm run build` clean **and** `npx eslint --max-warnings 50` clean.

## Report back (then STOP)
Deliver: branch name, PR link (unmerged), the 3 migration files (unapplied), a checklist of the verification results with evidence, and any deviations from this brief. **Do not merge, do not apply migrations, do not deploy.** Opus reviews next.

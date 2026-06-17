# Branches (Multi-Office) — Implementation Brief

**Status:** 🟢 IN PROGRESS — **Phase 0 + Phase 1a (backend) DONE + Opus-reviewed ✅.** Branch `feature/branches` off `stage`, commits: `3902997` (P0 seam) → `1d301e8` (P1a backend) → `14f911e` (fixback: centralized branch scoping in `requireLeadAccess` + audited all `[id]` sub-routes) → `eb97eb3` (fixback: closed pre-existing counselor gap on activities/insights/check-in(s) + DRY'd 11 inline checks into `requireLeadBranchAccess`). **Migrations 051/052/053 NOT applied — deferred to one bundle on Sadin's GO** (verified absent on shared DB; safe pre-migration via `?? "starter"` fallback + dormant `team` scope). Branch isolation airtight on every lead read/write path. **Phase 1b (UI) DONE + Opus-reviewed ✅** (`8f61fe4`): Settings→Branches manager, per-user branch picker on team/org-structure + `/api/v1/team` PATCH/GET `branch_id`, leads Branch column + bulk "Assign to branch" + admin branch switcher, `getBranches()` helper, SSR `?branch_id=` override (admin/`all`-scope only — verified). ALL branch UI gated on `entitlements.maxBranches > 1` (invisible to non-Enterprise). Build clean; full-repo eslint 0 errors / 30 baseline warnings (verified). **PHASE 1 COMPLETE.** Remaining (all need Sadin's explicit GO): (1) apply migs `051+052+053` to shared DB as one bundle, (2) seed Admizz (KTM/Birgunj/Janakpur + roster + manager assignments + flip plan→enterprise; Opus writes a reviewed dry-run first), (3) local-dev verification, (4) merge `feature/branches`→stage→main. Phase 2 (form→branch routing, round-robin, branch-scoped dashboards) deferred to a separate brief.

**SEED APPLIED to shared DB 2026-06-16 ✅** (migs 051/052/053 applied; `scripts/seed-admizz-branches.ts --apply`). Admizz flipped to `plan=enterprise`; branches KTM/Birgunj/Janakpur created with managers bijay.dahal/umesh.chaudhary/manish.jnk; "Lead Caller"→"Lead Executive" + both Lead Executive & Application Executive aligned to `leadScope=own` (were `all`, 0 members — safe); 11 roster users created (creds handed to Sadin), mamata.sah@admizz.org promoted counselor→Admin; existing accounts (admizzdotcom2020 owner/dev, manish.sah@admizz.com admin, birgunj@/janakpur@/hello@ counselors) left untouched/unbranched. **Caught + fixed a script bug during dry-run** (Application Executive role mis-derived as viewer because the in-memory position map wasn't refreshed after the leadScope align). **Remaining: merge `feature/branches` → stage (dev smoke) → main (prod), each on Sadin's GO.** NOTE: dev+prod share this DB, so the seed + enterprise flag are already live on prod data, but branch UI/scoping code is only visible once `feature/branches` merges to main.
**Author:** Opus (planning) · **Executor:** Sonnet (code) · **Reviewer:** Opus · **Smoke:** Sadin
**Call sign:** `BRANCHES`
**Created:** 2026-06-16

---

## 1. What this is

A **branch / office layer** for tenants that have multiple physical offices. Launch customer: **Admizz Education** (`education_consultancy`), branches **KTM / Birgunj / Janakpur**. The product pattern is HubSpot **Teams** / Salesforce **role-hierarchy + territory**: a record carries a branch; a *branch manager* sees everything in their branch (without being a global admin); owner/admin see all branches.

**Scope classification: UNIVERSAL infra, gated by PLAN ENTITLEMENT — NOT industry-scoped.** This does **not** live under `src/industries/`. It lives in universal locations (`src/lib/api/`, `src/components/dashboard/`, `src/app/(main)/api/v1/branches/`, settings). Admizz is just the first user, exactly like Positions/RBAC (universal engine, education seeded first). Multi-branch unlocks on **Enterprise** plan only.

## 2. The three design properties (the spine — do not violate)

1. **Orthogonal.** Branch (`where`) is independent of Position (`what`). There is **one** `"Branch Manager"` position reused across all branches; *which* branch a manager runs comes from their `tenant_users.branch_id`. **Do NOT create per-branch positions** ("KTM Manager", "Birgunj Manager") — that's the anti-pattern.
2. **Inert when single-branch.** A tenant with no branches has every `branch_id = NULL` and behaves **byte-identical to today** — exactly how a NULL `position_id` reproduces pre-RBAC behavior. **No data backfill. No implicit "default branch" row.** NULL means "unscoped / unrouted".
3. **Plan-gated, not industry-gated.** The Branches UI + the ability to create a 2nd branch unlock only when `entitlements.maxBranches > 1` (Enterprise). Everything ships universally but stays dormant otherwise.

## 3. Decisions locked (Sadin, 2026-06-16)

- Multi-branch tier = **Enterprise only**.
- One branch per user, **freely movable** (single nullable FK, mutable).
- Visibility matrix:

| Role (position) | base_tier | leadScope | Sees | Assigns leads to |
|---|---|---|---|---|
| Owner / Admin | owner/admin | all | all branches (+ switcher) | anyone |
| **Branch Manager** | member | **team** | leads where `branch_id = theirs` | users in their branch only |
| Lead Executive | member | **own** | own assigned only | — |
| Counselor | member | own | own assigned only | — |
| Application Executive | member | own | own assigned only | — |

> Only **Branch Manager** is `team`-scoped. Lead Executive & Application Executive are functionally counselors with different titles (own scope) — they are **custom positions**, created during seeding, NOT system positions.

- User management stays **admin-only** in Phase 1 (branch managers assign *leads*, not *people*).
- Lead → branch routing Phase 1 = **manual** (bulk "Assign to branch" + branch filter). Form-default + round-robin = Phase 2.
- Unrouted leads (`branch_id NULL`) = admin "Overall / Unassigned" pool; counselors still see their own assigned regardless of branch.

## 4. ⚠️ Critical guards (security — caught during planning)

1. **`team` scope + NULL branch_id MUST fall back to `own`, never `all`.** A team-scoped user whose `branch_id` is NULL must see only their own assigned leads (most-restrictive safe fallback) — otherwise the "no branch filter" path would leak the entire tenant. Enforce in the resolver (§Phase 1.2).
2. **Branch-manager assignment guard.** A `team`-scoped actor (non-admin) may only set `assigned_to` / `branch_id` when BOTH the lead's `branch_id` AND the target user's `branch_id` equal the actor's own `branch_id`. Owner/admin bypass. Enforce in `PATCH /api/v1/leads/[id]` and the bulk route.
3. **Branch Manager nav must NOT include `/team`.** They manage lead assignment from the leads surface, not user management. Their position `nav` allow-list = `/leads` (+ `/home`, `/insights` if desired) — never `/team`.
4. **`scopedClient.update()` on `branch_id` still needs a caller filter** (`.eq("id", leadId)`) beyond the auto tenant filter — standard wrapper rule.

---

## PHASE 0 — Entitlements seam (small; lands first)

**Goal:** introduce the single place plan limits resolve. Build the SEAM, not billing. ~1 column + 1 file.

### 0.1 Migration `051_tenant_plan.sql`
```sql
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter'
    CHECK (plan IN ('starter','professional','enterprise')),
  ADD COLUMN IF NOT EXISTS entitlement_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;
```
No RLS change (tenants table already covered). Additive, dormant — every existing tenant defaults to `starter`. **Admizz will be flipped to `enterprise` during seeding (Phase 1 done), not in this migration.**

### 0.2 `src/lib/api/entitlements.ts` (new — the ONE seam)
```ts
export type Plan = "starter" | "professional" | "enterprise";
export interface Entitlements {
  maxBranches: number;       // 1 = single-office (no multi-branch UI)
  maxSeats: number;
  multiPipeline: boolean;
  apiAccess: boolean;
}
const PLAN_ENTITLEMENTS: Record<Plan, Entitlements> = {
  starter:      { maxBranches: 1,        maxSeats: 5,        multiPipeline: false, apiAccess: false },
  professional: { maxBranches: 1,        maxSeats: 25,       multiPipeline: true,  apiAccess: true  },
  enterprise:   { maxBranches: Infinity, maxSeats: Infinity, multiPipeline: true,  apiAccess: true  },
};
export function resolveEntitlements(tenant: { plan?: string | null; entitlement_overrides?: Record<string, unknown> | null }): Entitlements {
  const base = PLAN_ENTITLEMENTS[(tenant.plan as Plan) ?? "starter"] ?? PLAN_ENTITLEMENTS.starter;
  return { ...base, ...(tenant.entitlement_overrides ?? {}) };
}
```
> This is the entitlement twin of `resolvePermissions()`. When Stripe lands later, a webhook writes `tenants.plan`; nothing else changes. It also becomes the future home for enforcing the OTHER PRICING.md limits (lead caps, seats, multi-pipeline, API) — out of scope here, just noting the seam is reusable.

### 0.3 Thread `plan` through the loaders
- `src/lib/api/auth.ts` — `authenticateRequest()` select (currently `tenant_id, role, position_id, tenants(industry_id), positions(permissions)` ~line 46): add `plan, entitlement_overrides` to the `tenants(...)` embed. Add `plan: string` (+ resolved `entitlements`) to `AuthContext` (interface ~line 7). Resolve via `resolveEntitlements`.
- `src/lib/supabase/queries.ts` — `getCurrentUserTenant()` already `.select("*")` on tenants (~line 29) so `plan`/`entitlement_overrides` come for free; add resolved `entitlements` to its return object so the dashboard layout/UI can gate the Branches surface.

**STOP for Opus review** after Phase 0. (No user-visible change yet — pure seam.)

---

## PHASE 1 — Branches feature

### 1.1 Migrations

**`052_branches.sql`**
```sql
CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  manager_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "branches_select" ON branches FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "branches_insert" ON branches FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "branches_update" ON branches FOR UPDATE USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "branches_delete" ON branches FOR DELETE USING (is_tenant_admin(tenant_id));

ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE leads        ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_tenant_branch        ON leads(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_branch ON tenant_users(tenant_id, branch_id);
```
> `ON DELETE SET NULL` on both FKs — deleting a branch never destroys leads/users; they drop to the unrouted pool. **No backfill.**

**`053_branch_manager_position.sql`** — seed the one system position for education tenants (mirrors mig 030's seed pattern, education-gated). `leadScope: "team"`, `canEditLeads: true`, nav allow-list WITHOUT `/team`:
```sql
INSERT INTO positions (tenant_id, name, slug, base_tier, is_system, permissions)
SELECT t.id, 'Branch Manager', 'branch-manager', 'member', true,
  '{"nav":{"mode":"allow","keys":["/home","/leads","/insights","/inbox"]},
    "pipelines":{"mode":"all"},"leadScope":"team","canEditLeads":true,
    "dashboard":{"widgets":{"mode":"allow","keys":["stats","leads-by-stage","leads-by-source","utm"]}}}'::jsonb
FROM tenants t
WHERE t.industry_id = 'education_consultancy'
  AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.tenant_id = t.id AND p.slug = 'branch-manager');
```
> Confirm the exact nav keys against the live `permissions.nav` key conventions before applying — keys are universal hrefs / industry featureIds (see `permissions.ts` line 5). Adjust `/insights`/`/inbox` if those aren't the live keys for Admizz.

### 1.2 Resolver wiring (`src/lib/api/permissions.ts`)
- Extend `LeadQueryScope` (~line 81) with `branchId: string | null`.
- `leadQueryScope(p, userId, branchId)` — add a 3rd param (the user's `branch_id`). Logic:
  - `restrictToSelf = p.leadScope === "own" || (p.leadScope === "team" && !branchId)`  ← **the NULL-branch fallback guard (§4.1)**
  - `branchId = p.leadScope === "team" && branchId ? branchId : null`
- `shouldRestrictToSelf` (~line 67): keep returning `leadScope === "own"` for the simple callers, but anywhere it gates a team-scoped user, prefer `leadQueryScope`. (Audit the 2–3 call sites.)
- `deriveRole` (~line 95): `team` currently → `viewer`. Branch Manager is `team` + `member`; `deriveRole(member, team)` returns `viewer` today, which is acceptable for the legacy `role` column (read-only-ish), BUT verify the legacy counselor self-scope (`auth.role === 'counselor'` overrides) does NOT misfire for a branch manager. A branch manager's legacy role will be `viewer`, not `counselor` — fine (no self-restrict). Confirm no code keys off `role === 'viewer'` to BLOCK lead edits the branch manager needs (`canEditLeads:true` is the real gate). Document the finding in the review.

### 1.3 Thread `branchId` into AuthContext + every lead query
- `src/lib/api/auth.ts`: add `branch_id` to the `tenant_users` select (~line 46); add `branchId: string | null` to `AuthContext` (~line 7); extract `branchId: membership.branch_id ?? null` (~line 83).
- `src/app/(main)/api/v1/leads/route.ts` GET (~lines 86–125): replace the manual `shouldRestrictToSelf`/`assignedTo` block with a `leadQueryScope(auth.permissions, auth.userId, auth.branchId)` call; apply `if (scope.branchId) query = query.eq("branch_id", scope.branchId)` and keep the existing `assigned_to`/pipeline filters. ALSO accept an admin `?branch_id=` query param (the switcher) — applied only for `all`-scope callers (ignore/forbid for team/own to prevent a counselor spoofing another branch).
- `src/lib/supabase/queries.ts`:
  - `getLeads()` (~line 55): add `branchId?: string | null` to scope; `if (scope?.branchId) query = query.eq("branch_id", scope.branchId)` (~after line 66).
  - `getLeadsForPipeline()` (~line 248): same addition (~after line 271).
  - Update the SSR callers (dashboard/pipeline pages) to pass `auth.branchId` / position branch into the scope (grep callers of `leadQueryScope`).

### 1.4 Branches API — `src/app/(main)/api/v1/branches/`
- `route.ts`: `GET` (list tenant branches, any member) + `POST` (create; admin-only; **entitlement gate**: `if (currentBranchCount >= resolveEntitlements(tenant).maxBranches) return apiError(402/403, "PLAN_LIMIT")`).
- `[id]/route.ts`: `PATCH` (rename, set `manager_user_id`, sort_order; admin-only) + `DELETE` (admin-only; FKs SET NULL handle orphans).
- All routes: `authenticateRequest()` + `scopedClient(auth)`. Not industry-gated; gated by entitlement + admin.

### 1.5 Lead assignment guards
- `src/app/(main)/api/v1/leads/[id]/route.ts`: add `"branch_id"` to UPDATABLE_FIELDS + ADMIN-or-team logic. Validate target branch belongs to tenant (mirror the existing assigned_to member-check ~lines 157–166). Add the **team-scope assignment guard (§4.2)**: if `auth.permissions.leadScope === "team"` (non-admin), require the lead's existing `branch_id === auth.branchId` AND, when setting `assigned_to`, the target user's `branch_id === auth.branchId`; else 403.
- `src/app/(main)/api/v1/leads/bulk/route.ts`: accept optional `branch_id` (bulk "assign to branch"); apply same guard.

### 1.6 UI
- **Settings → Branches** (new card/section) — gate render on `entitlements.maxBranches > 1`. CRUD list (name, manager picker, sort), wired to `/api/v1/branches`. (Decide Settings-card vs a tab in Org Structure during build; Settings is the simpler default.)
- **Per-user branch picker** — `src/components/dashboard/team-management.tsx`: add `branch_id` to `TeamMember` (~line 24); add a Branch `<select>` next to the position editor (mirror `savePosition` → `saveBranch` calling `PATCH /api/v1/team` with `{ user_id, branch_id }`). Show only when `entitlements.maxBranches > 1`.
- **`/api/v1/team` PATCH** (`src/app/(main)/api/v1/team/route.ts` ~line 119): accept `branch_id?: string | null`; validate branch belongs to tenant; set `patch.branch_id`. Admin-only (already is).
- **Leads table** — `src/components/dashboard/leads/columns-registry.tsx`: add a `branch` static column (label "Branch", render `ctx.branchMap[lead.branch_id] ?? "—"`); add `branchMap` to `LeadColumnCtx`. `src/components/dashboard/leads-table.tsx`: build `branchMap` from the branches list; add a bulk **"Assign to branch"** action in the bulk toolbar (~lines 886–932, mirror `handleBulkAssign`) → calls bulk route with `branch_id`. Gate the column/action on `entitlements.maxBranches > 1`.
- **Admin branch switcher** — an "Overall + per-branch" dropdown on `/leads` (drives `?branch_id=`). Render only for `all`-scope users when `entitlements.maxBranches > 1`. (Dashboard/Insights switcher = Phase 2.)

**STOP for Opus review** after Phase 1.

---

## PHASE 2 — Global branch switcher in the top bar (Zenly-style)  ← NEXT

**Goal:** elevate branch context to the dashboard **header** (`shell.tsx`) and make it **global** across dashboard + leads + pipeline (v1 scope — NOT insights/campaigns yet). Two distinct UIs by role (Sadin 2026-06-16):

- **Admin / owner (`leadScope: all`):** a **changeable** dropdown — `Overall` + each branch. Selecting one scopes dashboard + leads + pipeline to that branch. Selection **persists via a cookie** (`edgex_branch`, value = branch id or `all`; default `all`). Replaces the Phase-1 `/leads` filter-row switcher (remove that to avoid two switchers).
- **Branch-scoped user (`leadScope: team`/`own` WITH a `branch_id`):** a **static, non-changeable branch badge** showing their branch name (e.g. "KTM"). Informational only — they're already locked by the backend. No dropdown.
- **Everyone else / `maxBranches <= 1`:** render nothing.

### Mechanics
- **Cookie is a UI convenience, NOT a security boundary.** The backend already enforces real scope (Phase 1a). The cookie is only *honored for `all`-scope users* server-side; branch-scoped users ALWAYS use their own `auth.branchId` and the cookie is ignored. So even a forged cookie can't widen anyone — an admin selecting a branch is within their rights anyway.
- **Component:** new client `BranchSwitcher` mounted in `shell.tsx` header (~line 413, near `NotificationsDropdown`). On select (admin): set cookie `edgex_branch` (client-side, path=/) then `router.refresh()` so SSR re-reads it. Branch badge for branch users is static text.
- **Layout plumbing:** `(main)/(dashboard)/layout.tsx` (server) already calls `getCurrentUserTenant()` (returns `entitlements`, `branchId`, `permissions`). Add a `getBranches(tenant.id)` fetch (only when `maxBranches > 1`) + read the `edgex_branch` cookie, and pass `branches`, `maxBranches`, the user's own `branchId`, `leadScope`, and the selected cookie value into `DashboardShell` → `BranchSwitcher`.

### SSR application (the 3 surfaces)
For each page, compute the effective branch filter: `selected = (leadScope === 'all' && cookie && cookie !== 'all') ? cookie : null`, then apply via the existing `leadQueryScope` branch param. Branch-scoped users keep their Phase-1 behavior (their own branch via `auth.branchId`).
- **`dashboard/page.tsx:19`** — currently `leadQueryScope(permissions, userId)` with **NO branch arg** (bug: branch managers' dashboard isn't scoped today). Fix: pass the user's branch, AND for admins apply the cookie override. All stats/charts derive from that one `getLeads`, so this one change scopes the whole dashboard.
- **`leads/page.tsx`** — switch the admin override source from `?branch_id=` URL param to the `edgex_branch` cookie; remove the filter-row switcher + `activeBranchId` prop wiring (now driven by the header). Keep the Branch column.
- **`pipeline/page.tsx`** — already passes `leadQueryScope(permissions, userId, branchId)`; add the same admin cookie override.

### Gating / verification
- All header UI gated on `entitlements.maxBranches > 1`.
- Admin: pick "Birgunj" in header → dashboard stats, leads, pipeline all show only Birgunj; "Overall" → everything; selection survives navigation + reload (cookie).
- Branch manager (bijay/KTM): header shows a static "KTM" badge, no dropdown; dashboard/leads/pipeline already KTM-only.
- Non-enterprise tenant / it_agency: no header branch UI; dashboard/leads/pipeline unchanged.

### Sonnet handoff (Phase 2)
> Build Phase 2 (global branch switcher) from `docs/BRANCHES-BRIEF.md` §"PHASE 2", on the existing `feature/branches` branch (Phases 0/1a/1b are committed there). Scope = dashboard + leads + pipeline ONLY. Admin/owner get a changeable Overall+per-branch dropdown in the `shell.tsx` header backed by an `edgex_branch` cookie (`router.refresh()` on change); branch-scoped users get a static branch-name badge; render nothing when `maxBranches <= 1`. The cookie is honored server-side ONLY for `leadScope === 'all'` users (never widens a branch/own user). Wire the cookie override into `dashboard/page.tsx` (also FIX the missing branch arg in its `leadQueryScope` call), `leads/page.tsx` (replace the filter-row switcher + `?branch_id=` with the header+cookie; keep the Branch column), and `pipeline/page.tsx`. Plumb `branches`/`maxBranches`/user `branchId`/`leadScope`/selected-cookie through `(main)/(dashboard)/layout.tsx` → `DashboardShell`. Do NOT touch the Phase-1 backend guards. No migrations. Stay on `feature/branches`; commit + STOP at review; run `npm run build` + `npx eslint . --max-warnings 50` (whole repo) and paste real output; report the diff.

## PHASE 3 (later — separate brief)
- Per-form default branch (reuse per-form pipeline-routing pattern).
- Round-robin auto-assign within a branch.
- Branch-scoped Insights/Campaigns + branch-level reporting (conversion by branch).

---

## Non-goals / explicit "do NOT"
- ❌ No backfill of existing leads/users to a default branch. NULL = unscoped.
- ❌ No implicit per-tenant "default branch" row.
- ❌ No per-branch positions. One "Branch Manager" position + `branch_id`.
- ❌ No billing/Stripe. Only the entitlements seam + `tenants.plan` default.
- ❌ Branch Manager gets NO `/team` nav and NO admin powers (stays `base_tier: member`).
- ❌ Do NOT let `?branch_id=` widen a team/own user's scope — it's an admin focus filter only.

## Verification (before each STOP)
- `npm run build` clean + `npx eslint --max-warnings 50` (run the lint explicitly — build-clean has shipped red before).
- Local `npm run dev` against a LOCAL/throwaway DB (not shared Supabase) for write-path checks.
- Single-branch tenant (no branches created) = identical to today: leads list, pipeline, counselor self-scope, admin all-scope all unchanged.
- Multi-branch (Enterprise + 2 branches): branch manager sees only their branch; counselor sees only own; admin sees all + switcher works; team-manager with NULL branch sees only own (the §4.1 fallback); cross-branch assignment by a manager → 403.
- Starter/Professional tenant: Branches UI hidden; `POST /api/v1/branches` 2nd branch → 402/403.

## Seeding (AFTER Phase 1 ships — separate step, Sadin + Opus)
From the Admizz roster screenshot. Branches: **KTM, Birgunj, Janakpur**. Some users already exist (detect by email, link — do NOT duplicate). New users minted via the admin/onboard path (NOT by handling the sheet's plaintext passwords casually). Positions: Owner/Admin (existing), **Branch Manager** (new system position, mig 053) for Bijay Dahal (KTM) / Umesh Chaudhary (Birgunj) / Manish Sah (Janakpur); **Lead Executive** + **Application Executive** = Admizz custom positions (own scope, created via positions manager or seed). Set each user's `branch_id`; set each branch's `manager_user_id`. Flip Admizz `tenants.plan = 'enterprise'`. A dry-run seed plan will be written separately and reviewed before applying to the shared DB.

---

## Sonnet handoff (Phase 0 first)

> Build **Phase 0 only** (the entitlements seam) from `docs/BRANCHES-BRIEF.md` §Phase 0. Migration `051_tenant_plan.sql` + `src/lib/api/entitlements.ts` + thread `plan`/`entitlements` through `authenticateRequest()` and `getCurrentUserTenant()`. Do NOT apply the migration. Do NOT start Phase 1. Run `npm run build` + `npx eslint --max-warnings 50` and STOP at the review gate — leave everything on a `feature/branches` branch, committed but unpushed. Report the diff for Opus review.

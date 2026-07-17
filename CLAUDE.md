# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Git Hooks

A `commit-msg` hook (`.git/hooks/commit-msg`) replaces the default Anthropic co-author line with `Co-Authored-By: Anish Balami <anishbalami38@gmail.com>` on every commit. This hook lives in `.git/hooks/` (not tracked by git) and must be re-created if the repo is re-cloned.

---

## Industry Scoping Rules

**IMPORTANT: Current development focus is `education_consultancy` ONLY.** ALL new features default to education_consultancy unless the user explicitly says otherwise. If unsure whether a feature is universal or industry-specific, ASK — don't assume. Every new feature MUST have its own folder at `src/industries/education-consultancy/features/<feature-name>/`. When modifying universal components, gate education-only UI with `industryId === "education_consultancy"`.

The product is an **AI-native operating system per industry tenant**. Each tenant belongs to **exactly one industry** (`tenants.industry_id` — see `supabase/migrations/012_industry_customization.sql` for the 7 seeded industries). The codebase is structured so industry-specific features live in their own modules, universal features stay shared, and multiple developers can work on different industries in parallel without merge conflicts on shared files.

> **New to the codebase?** Start with [`docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md`](./docs/reference/01-ARCHITECTURE-INDUSTRY-MODULES.md) — it explains *why* this pattern exists, with diagrams comparing the old flat structure to the current industry-module structure. This section below has the *rules* (do-this checklist); that doc has the *reasoning*.

### The two-homes rule

| Where it lives | What goes there |
|---|---|
| `src/app/(main)/(dashboard)/<feature>/` + `src/components/dashboard/<feature>.tsx` | **Universal features** — used by every tenant regardless of industry. Examples: leads, pipeline, team, settings. |
| `src/industries/<industry-id>/features/<feature>/` | **Industry-scoped features** — used by one industry only. Example: `industries/education-consultancy/features/check-in/`. |
| `src/industries/_shared/features/<feature>/` | **Cross-industry shared features** — used by multiple industries (but not all). Each consuming industry's `manifest.ts` opts in. |

### Three feature categories

Before implementing anything, classify it:

- **Global** — works for all tenants, ignores `industry_id`. Lives in `src/app/...`.
- **Industry-aware** — works for all tenants but adapts labels/behavior based on `industry_id` (e.g. pipeline default stages, entity manager labels).
- **Industry-scoped** — only available to tenants matching one or more `industry_id`s. Sidebar item hidden, route 404, API 403 for mismatched tenants. Lives in `src/industries/<id>/features/`.

### How a feature is gated

For industry-scoped features, the gate is enforced in **three places**, all backed by one truth function (`getFeatureAccess` in `src/industries/_loader.ts`):

1. **Sidebar** — the dashboard layout calls `getIndustrySidebarItems(industry_id)` to merge industry nav into the universal nav.
2. **Route shell (page)** — `src/app/.../<feature>/page.tsx` is a thin shell that calls `getFeatureAccess(...) → notFound()` and then delegates to the UI component in the industry folder.
3. **API routes** — call `getFeatureAccess(auth.industryId, FEATURES.X) → apiForbidden()` after authentication.

The truth function reads each industry's `manifest.ts`. Change the answer there once, and sidebar / route / API all update.

### Manifest pattern

Each industry exports a `manifest.ts` declaring its features, sidebar items, and AI config:

```ts
// src/industries/education-consultancy/manifest.ts
import { FEATURES, INDUSTRIES } from "../_registry";
import { checkInMeta } from "./features/check-in/meta";
import { formBuilderMeta } from "./features/form-builder/meta";

export const manifest: IndustryManifest = {
  id: INDUSTRIES.EDUCATION_CONSULTANCY,
  features: [{ meta: checkInMeta }, { meta: formBuilderMeta }],
  sidebar: [
    { featureId: FEATURES.CHECK_IN, href: "/check-in", label: "Check-In", icon: UserCheck },
    { featureId: FEATURES.FORM_BUILDER, href: "/forms", label: "Forms", icon: FileText },
  ],
  ai: aiConfig,
};
```

### Feature registry (single source of truth for IDs)

Every feature ID is a constant in `src/industries/_registry.ts`. Manifests reference these constants, never raw strings. TypeScript catches typos at compile time.

```ts
// src/industries/_registry.ts
export const FEATURES = {
  CHECK_IN: "check-in",
  FORM_BUILDER: "form-builder",
} as const;
```

### Parallel work is conflict-free

Universal features are touched only when changing universal behavior. Industry features are owned by their industry folder — adding the next education feature touches only `industries/education-consultancy/`, not `shell.tsx` or any shared file. Two developers working on different industries don't collide.

### Cross-industry reuse: promote, don't copy

When a second industry wants a feature that already exists in one industry's folder:

1. `git mv src/industries/<original>/features/<feature>/ src/industries/_shared/features/<feature>/`
2. Update the original industry's manifest import path.
3. Add a registration in the new industry's manifest (optionally with industry-specific `config`).

**Never copy-paste a feature folder between industries.** That's how duplication grows.

### Current feature classification

| Feature | Scope | Industries |
|---|---|---|
| Leads / pipeline / team / settings | Global | all |
| Default pipeline stages | Industry-aware | all (different defaults per industry) |
| Industry entities manager | Industry-aware | all with industry set |
| Email auto-forward + Gmail OAuth | Global | all |
| Multi-pipeline | Global | all |
| AI chat (`/api/v1/ai/chat`) | Global | all (placeholder; per-industry config later) |
| Notifications | Global | all |
| **Student check-in** | **Industry-scoped** | **education_consultancy** |
| **Form builder** | **Industry-scoped** | **education_consultancy** |

For a fuller, machine-friendly view see `docs/FEATURE-CATALOG.md`.

### How to scope a new feature (decision tree)

```
Q: How many industries will use this feature?
├─ All tenants regardless of industry?           → Universal: src/app/...
├─ Exactly one industry?                          → Industry-scoped: src/industries/<id>/features/...
└─ Multiple industries but not all?               → Shared: src/industries/_shared/features/... + manifest opt-in

Q: Does the feature need to behave differently per industry?
├─ No, identical behavior                         → Shared with no config
└─ Yes, labels/limits/UI variants                 → Shared with per-industry `config` on the manifest entry
```

### Migrating an existing flat-pattern feature into the new structure

Use this when adapting code that was built against the old flat pattern (`src/features/<feature>/` with inline `if (industry_id !== ...) return <NotAvailable />` guards). The check-in and form-builder migrations are the working precedent — grep their commit history if you need a concrete reference.

1. **Sync the branch first.** `git stash` any uncommitted work, then `git pull --rebase origin stage`, then `git stash pop`. Resolve conflicts — `src/components/dashboard/shell.tsx` is the most likely conflict point if the feature touched the sidebar.
2. **Classify the scope** using the decision tree above. For an industry-specific feature, it lives in `src/industries/<industry-id>/features/<feature>/`.
3. **Move with `git mv`** to preserve history:
   - `src/features/<feature>/` → `src/industries/<industry-id>/features/<feature>/`
   - Or `src/components/dashboard/<feature>.tsx` → `src/industries/<industry-id>/features/<feature>/ui.tsx`
4. **Update consumer imports.** `grep -rn '@/features/<feature>\|@/components/dashboard/<feature>' src/` and update every match to the new path.
5. **Create `meta.ts`** in the feature folder:
   ```ts
   import { FEATURES, INDUSTRIES } from "../../../_registry";
   import type { FeatureMeta } from "../../../_types";
   export const <feature>Meta: FeatureMeta = {
     id: FEATURES.<FEATURE_ID>,
     industries: [INDUSTRIES.<INDUSTRY_ID>],
   };
   ```
6. **Register in `_registry.ts` and the industry manifest:**
   - Add the feature ID constant to `FEATURES` in `src/industries/_registry.ts`.
   - Import `<feature>Meta` in `src/industries/<industry-id>/manifest.ts` and push `{ meta: <feature>Meta }` onto `features[]`.
   - If the feature has a top-level page, add a `SidebarItem` to `sidebar[]` with the icon name as a **string** (e.g. `"FileText"`).
7. **Replace inline industry guards with the loader pattern:**
   - **Page route shells** (`src/app/(main)/(dashboard)/<feature>/page.tsx`): drop the inline `if (tenant.industry_id !== "...") return <NotAvailable />`. Use:
     ```ts
     import { notFound } from "next/navigation";
     import { getFeatureAccess } from "@/industries/_loader";
     import { FEATURES } from "@/industries/_registry";
     // inside the page:
     if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.<FEATURE_ID>)) notFound();
     ```
   - **API routes**: after `authenticateRequest()`, add:
     ```ts
     if (!getFeatureAccess(auth.industryId, FEATURES.<FEATURE_ID>)) return apiForbidden();
     ```
   - Apply to every API route the feature owns. Form-builder and check-in show the working shape.
8. **Use `scopedClient(auth)` for new tenant-touching queries.** Old `createServiceClient()` queries in untouched routes can stay (they're tracked on STATUS-BOARD for ongoing migration), but anything new defaults to the safe wrapper. See Tenant Isolation Rules below.
9. **Update `docs/FEATURE-CATALOG.md`** with the feature row: id, location, industries, owner.
10. **Verify before committing:**
    - `npm run build` clean.
    - Manual UI as a tenant **in** the registered industry → feature visible, sidebar item present, pages render, APIs return 200.
    - Manual UI as a tenant **NOT** in the industry → sidebar item hidden, direct URL 404s, APIs return 403.
    - Universal features (leads, pipeline, team, settings) unchanged on both tenants.

**Two pitfalls that keep biting:**

- **Sidebar icons must be string names, not `LucideIcon` component imports.** The manifest crosses the Server Component → Client Component boundary; non-serializable props crash the dashboard. Register the icon name in the `INDUSTRY_ICONS` registry in `src/components/dashboard/shell.tsx` if it isn't already there.
- **`scopedClient.update()` and `.delete()` always require a caller-supplied filter** (e.g. `.eq("id", leadId)`) beyond the auto-injected `tenant_id`. Without one, the operation targets every row in the tenant. The wrapper can't enforce this at compile time — review catches it.

### Tenant model

**One tenant = one industry.** Hybrid organizations run multiple tenants under separate logins (matches how Salesforce/HubSpot/Notion handle business units). No multi-industry-per-tenant complexity — it's a deliberate design choice; revisit only if a real customer requests it.

---

## What This Is

Multi-tenant lead generation CRM SaaS (Zunkiree Labs). White-label system where each client (university, business) gets their own tenant with configurable forms, branding, and a dashboard to manage leads.

---

## Read first, every session

0. **`docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` — how code & DB changes move to prod safely (branch/PR discipline, migration-before-code ordering, promotion & rollback runbooks, shared-file conflict rules). Non-negotiable process. Read before any branch/PR/migration/deploy. This is what keeps features from "reverting" on prod.**
1. `docs/SESSION-LOG.md` — current state of the project. The "🟢 NEXT SESSION — RESUME HERE" block at the top tells you exactly where to pick up.
2. `docs/STATUS-BOARD.md` — live status of open user-side actions and questions.
3. `docs/FEATURE-ROADMAP.md` — forward-looking pipeline of features by state (ideas → approved → planned → in-progress). Where new feature ideas are logged and where we pick the next thing to build.
4. `docs/FEATURE-CATALOG.md` — features that currently exist in code (current state, not future plans).
5. `docs/reference/` — stable docs:
   - `00-PRODUCT-VISION.md` — what we're building and why.
   - **`01-ARCHITECTURE-INDUSTRY-MODULES.md` — how the codebase is organized around industry modules. Required reading for any new dev (or Claude session) before touching `src/industries/` or building an industry-scoped feature.**
   - **`02-ARCHITECTURE-AI-KNOWLEDGE-LAYER.md` — target architecture for the AI-native knowledge layer (Orca-ready KB): storage seam → ingestion → pgvector retrieval → agent tools, with tool picks + privacy stance + "when to switch tools" thresholds. Read before building any KB/RAG/Orca-retrieval work; Phase 1/2/3 build briefs reference it.**
   - `api-contracts/` — integration API specs.
   - `PRICING.md` — live product pricing reference.
   Read for context; don't edit per-task.
6. `docs/archive/` — shipped or superseded work grouped by series (`features/`, `plans/`, `research/`, `ci-cd/`, `stale/`).

**Each living doc has one job — don't conflate them:**
- `SESSION-LOG.md` = historical record of what shipped, dated entries.
- `STATUS-BOARD.md` = open decisions / blockers needing Sadin's input.
- `FEATURE-ROADMAP.md` = forward pipeline of features (ideas → planned → WIP).
- `FEATURE-CATALOG.md` = features that exist in code today.

When a piece of work ships, append to SESSION-LOG, update FEATURE-CATALOG, move ROADMAP entry to "shipped" then prune, and `git mv` any associated brief into `docs/archive/<series>/`. Top-level `docs/` should only contain the four living docs above plus any in-flight `<CONTEXT>-BRIEF.md`.

---

## Two-session workflow: Opus plans, Sonnet executes

**This project is driven by two separate Claude sessions with strict role separation:**

- **Opus session = planner / lead / reviewer ("the brain").** Designs, decides, writes briefs, and reviews. **Opus does NOT execute the work itself** — no feature code, no migrations, no DB writes, no deploys, no spawning sub-agents to do it. (Infra/ops exceptions only when the user explicitly says "you do it.")
- **Sonnet session = executor.** A *different* Claude session the user runs separately. It writes the code / runs the commands.
- **The user is the courier between the two sessions.** Flow: Opus writes a brief → user pastes it into the Sonnet session → Sonnet does the work and produces a report → user brings the report back → **Opus reviews it** (and re-runs gates / verifies independently; never trust the executor's self-report — see memory `feedback_sonnet_oversteps_review_gate`).

So when execution is needed, Opus's deliverable is a **copy-pasteable brief for the user to hand to Sonnet**, not a tool action and not an `Agent`/sub-agent dispatch.

---

## Automatic Skill Routing

**IMPORTANT: This project uses orchestrated development.**

When the user gives ANY development request (build, create, implement, fix, update, change, refactor, feature requests, bug fixes, multi-step work), **automatically invoke `/project-pm`**.

**Exceptions** (do NOT auto-invoke): questions ("How does X work?"), reading ("Show me X"), documentation tasks, direct skill invocation (`/skill-name`), simple one-liner changes.

## Available Skills

| Skill | Domain |
|-------|--------|
| `/project-pm` | Orchestrator for all dev tasks |
| `/coo-it-agency` | Operating-strategy brain for `it_agency` tenants — whole-company product direction, end-to-end workflow design/critique, AI-native touchpoint hunting; sits above crm/hr experts and orchestrates them; advises & routes. One COO skill per industry. |
| `/pm-it-agency` | Delivery-execution brain for `it_agency` tenants — how projects actually get run (methodology, sprint/milestone/task/status/approval mechanics, resourcing, delivery-health metrics, RAID); optimizes the Delivery surface (Projects/Time Tracking/Approvals/Resourcing/Utilization) and proposes delivery features. Functional expert under coo-it-agency; advises & routes. One PM skill per industry. |
| `/crm-expert` | Lead workflows, pipeline design, CRM patterns |
| `/hr-expert` | HR/HRMS domain — org/positions, onboarding, leave/attendance, payroll, performance, ESS/MSS; plans people features, reuses existing team/positions spine, routes to dev skills |
| `/db-engineer` | Schema, migrations, SQL, RLS, tenant isolation |
| `/frontend-dev` | Pages, components, forms, React/shadcn/Tailwind |
| `/api-dev` | API routes, auth, validation, rate limiting |
| `/deploy` | GitHub Actions deploys, monitoring, health checks |
| `/perf-auditor` | Bundle size, query optimization, caching |
| `/widget-perf` | Embeddable form TTFB, bundle reduction |
| `/test-engineer` | Unit/integration/component tests |
| `/security-auditor` | RLS review, auth audit, OWASP, tenant isolation |
| `/ci-cd` | GitHub Actions pipelines, PR checks, auto-deploy |
| `/code-reviewer` | Bug detection, dead code, pattern consistency |
| `/skill-architect` | Create/optimize skills |
| `/ui-ux-expert` | Visual hierarchy, accessibility, UX reviews |

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5.x |
| UI | Tailwind CSS v4 + shadcn/ui |
| Backend | Supabase (PostgreSQL + Auth + Storage) |
| Deployment | Docker + Traefik on Node 22 Alpine |
| Logging | pino (structured) |
| Drag & Drop | @dnd-kit |
| Charts | recharts |
| Email | nodemailer + resend |

## Commands

```bash
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build — always run before pushing
npm run lint         # ESLint (next/core-web-vitals + typescript)
npm run start        # Start production server
```

No test runner is configured. Path alias: `@/*` maps to `./src/*`.

---

## CI/CD & Branching

**📖 The full process is `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` (index: `docs/dev-collab/README.md`) — READ IT before any branch/PR/migration/deploy work. Every human and every Claude session on this repo follows it. The rules below are the summary; that doc is authoritative.**

**ALL feature branches and PRs MUST merge to `stage` first. NEVER merge directly to `main`.**

```
feature/* ──► stage (staging) ──► main (production)
```

### The rules that keep prod from breaking (learned from real incidents)

1. **Branch from — and rebase onto — the LATEST `origin/stage`** right before you merge. A stale base is the #1 cause of a merge silently reverting someone else's work on a shared file (`shell.tsx`, `leads/queries.ts`, `leads/route.ts`, …). Resolve conflicts on those files **hunk-by-hunk**, never "keep my whole file."
2. **`main` auto-deploys on every push, with NO migration step.** So a coupled DB change must be **applied to the PROD database BEFORE the code merges to `main`** — else prod runs new code on an old schema → 500s (split-brain). Order is always: *apply migration to prod → verify → merge stage→main.*
3. **One migration number = one file, globally unique.** `ls supabase/migrations/ | sort` → take the next number; never reuse (we already have a duplicate `110_*` — don't add more). Transactional, additive, with a rollback line + before/after counts.
4. **Two separate Supabase DBs** (stage `dymeudcddasqpomfpjvt`, prod `pirhnklvtjjpuvbvibxf`). A migration on one is NOT on the other. "Applied" is meaningless without saying which DB. A migration is not on prod until you have personally run it on prod.
5. **Rollback (`rollback.yml`) is a fire alarm:** it reverts CODE only (not the DB), un-deploys everything after the target SHA, and detaches HEAD on the box. Announce before running; prefer a roll-*forward* revert PR.

| Trigger | Result |
|---------|--------|
| PR to `main` or `stage` | CI checks (lint, typecheck, build) |
| Push to `stage` | Auto-deploy to `dev-lead-crm.zunkireelabs.com` |
| Push to `main` | Auto-deploy to `lead-crm.zunkireelabs.com` (⚠️ no migration step) |
| Manual dispatch | Rollback (code only — see rule 5) |

```bash
# Before merging ANY PR, verify base branch
gh pr view <num> --json baseRefName  # Must be "stage"

# Start work: always from the latest stage
git fetch origin && git switch -c feature/<name> origin/stage
git fetch origin && git rebase origin/stage   # again right before merge

# main + stage are BRANCH-PROTECTED — no direct pushes. Everything is a PR.
# (If GitHub says the PR is out-of-date, click "Update branch" — required to merge.)

# Deploy staging: open + squash-merge a PR to stage (CI must be green + 1 approval — stage is branch-protected)
gh pr create --base stage --title "..." --body "..."
gh pr merge <num> --squash --delete-branch

# Promote to production — MIGRATIONS FIRST, THEN CODE
#   1) apply pending migrations to the PROD db (per-action approval) + verify
#   2) then promote code via a stage→main PR (1 approval; merge commit, not squash):
gh pr create --base main --head stage --title "Promote stage → main (prod deploy)" --body "..."
# ...get 1 approval, then merge it (merge commit) → auto-deploys prod.

# Monitor
gh run list --limit 5

# Rollback (reverts CODE only — not the DB; announce first)
gh workflow run rollback.yml -f commit_sha=<SHA> -f reason="description"
```

---

## App Architecture

### Route Groups

The app uses Next.js route groups to separate concerns:

- **`(main)`** — Full app: dashboard, API routes, auth. Has `Toaster`, fonts, metadata.
- **`(widget)`** — Lightweight embeddable form. Transparent background, minimal layout, preconnects to Supabase. No fonts/theme loaded.

### Dashboard Layout Chain

`(main)/layout.tsx` → `(main)/(dashboard)/layout.tsx` → page

The dashboard layout is a **Server Component** that:
1. Checks auth via `supabase.auth.getUser()`
2. Fetches tenant via `getCurrentUserTenant()`
3. Redirects to `/login` if no user, shows error if no tenant
4. Wraps children in `AIAssistantProvider` + `DashboardShell`

### Two Auth Systems

1. **Session-based** (`src/lib/api/auth.ts` → `authenticateRequest()`): For dashboard users. Returns `AuthContext` with `userId`, `email`, `tenantId`, `role`, **`industryId`**. Uses cookies + Supabase Auth.
2. **API key-based** (`src/lib/api/integration-auth.ts`): For external integrations. Bearer tokens prefixed `crm_live_...`, SHA-256 hashed, scope-based permissions.

### API Route Pattern

Most API routes live under `src/app/(main)/api/v1/`. Public submission API at `src/app/api/public/submit/`. Standard pattern:

1. Create request logger with `createRequestLogger()`.
2. Authenticate with `authenticateRequest()` (or integration auth).
3. **For industry-scoped features**: gate with `getFeatureAccess(auth.industryId, FEATURES.X) → apiForbidden()`.
4. Validate input with `validate()` helpers.
5. **For tenant data**: prefer `scopedClient(auth)` (auto-injects `tenant_id` filter) over `createServiceClient()` (raw, bypasses RLS — see Tenant Isolation Rules below).
6. Return via standardized helpers: `apiSuccess()`, `apiPaginated()`, `apiError()`, `apiUnauthorized()`, `apiForbidden()`, etc.

### Tenant Isolation Rules

**Three invariants every feature must respect.** Cross-tenant data leaks are the single biggest risk in a multi-tenant SaaS — these rules exist because we have **~37 of ~47 authenticated routes** using `createServiceClient()` (which bypasses RLS) and relying on the developer remembering `.eq("tenant_id", auth.tenantId)`. New code should not add to that pile.

1. **Authenticate first.** Every authenticated route calls `authenticateRequest()` → returns `AuthContext { userId, email, tenantId, role, industryId }`. No route accesses tenant data without one.

2. **Scope every tenant query.** Either:
   - Use the safe wrapper: `const db = await scopedClient(auth); db.from("leads").select(...)` — tenant filter is auto-injected. **Preferred for new routes.**
   - Or use `createServiceClient()` directly **and** explicitly add `.eq("tenant_id", auth.tenantId)` on every query. Legacy pattern; only acceptable for routes not yet migrated.
   - The `scopedClient` `raw()` escape hatch (`db.raw()`) exists for cross-tenant operations like `auth.admin.listUsers()` — name it deliberately so it can't be confused for the safe path.

3. **New tenant-owned tables need RLS.** Every new table with tenant data must have `tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE` plus RLS policies: `get_user_tenant_ids()` for SELECT, `is_tenant_admin(tenant_id)` for mutations.

#### New feature checklist

- [ ] Classify scope (Global / Industry-aware / Industry-scoped). Industry-scoped → folder under `src/industries/<id>/features/`.
- [ ] If new DB table: `tenant_id` FK + RLS policies using the SECURITY DEFINER helpers.
- [ ] API routes: `authenticateRequest()` + (if industry-scoped) `getFeatureAccess()` + `scopedClient(auth)`.
- [ ] Page routes (for industry-scoped features): thin shell that calls `getFeatureAccess() → notFound()` before delegating to the UI component.
- [ ] Manifest update: register feature meta + sidebar entry in the right industry's `manifest.ts`.
- [ ] Feature ID added to `src/industries/_registry.ts` constants.
- [ ] `docs/FEATURE-CATALOG.md` entry.

### Counselor Role Scoping

Counselor users are automatically filtered to only their assigned leads. This is enforced in API routes by overriding `assignedTo = auth.userId` when `auth.role === "counselor"`. Must be maintained in any new lead-related endpoints.

### Supabase Client Usage

- **Browser**: `src/lib/supabase/client.ts` → `createBrowserClient()` (respects RLS)
- **Server (user context)**: `src/lib/supabase/server.ts` → `createClient()` (respects RLS, uses cookies)
- **Server (admin)**: `src/lib/supabase/server.ts` → `createServiceClient()` (bypasses RLS, uses service role key)
- **Server (tenant-scoped — preferred)**: `src/lib/supabase/scoped.ts` → `scopedClient(auth)` (wraps service client; auto-applies `.eq("tenant_id", auth.tenantId)` for tenant-owned tables; `raw()` escape hatch for cross-tenant ops).

New authenticated routes should default to `scopedClient(auth)`. Legacy routes using `createServiceClient()` + manual `.eq("tenant_id", ...)` are tracked for migration on `docs/STATUS-BOARD.md`.

---

## Database

### RLS Architecture

**CRITICAL**: RLS uses `SECURITY DEFINER` functions to avoid infinite recursion:
- `get_user_tenant_ids()` — returns tenant IDs for current auth user
- `is_tenant_admin(tenant_id)` — checks if current user is owner/admin

These bypass RLS internally since `tenant_users` policies can't reference `tenant_users` itself. All other table policies call these functions.

### Key Design Patterns

- **`custom_fields` JSONB** on leads — extra form fields per tenant without schema changes
- **`form_configs.steps` JSONB** — entire form structure (fields, validation, conditional visibility) as JSON, rendered dynamically by `public-form.tsx`
- **Soft deletes** on leads — `deleted_at` column; all queries must filter `WHERE deleted_at IS NULL`
- **Idempotency** — `idempotency_key` on leads + `integration_idempotency` table
- **Multi-pipeline** — tenants can have multiple pipelines with custom stages
- **Lead Lists = "Stage" in UI** — the `lead_lists` table / `list_id` field is called "Stage" in the UI (renamed from "List" as of 2026-07-05). The pipeline stages Pre-qualified, Qualified, Prospects, Applications are the user-facing "Stages". Admin-only lists (Migration QC, Existing Leads edgeX, New Leads, NEB-10k-remaining) are hidden from non-admin/owner users in stage dropdowns. Always use the label "Stage" in any new UI that references `lead_lists`.

### Migrations

Migrations are in `supabase/migrations/` numbered sequentially (001-019). Applied via Supabase MCP or directly. Migration 019 adds `tags TEXT[]` column to leads.

### Current Data

- 3 tenants: "Zunkiree Labs" (slug: `zunkireelabs-crm`, industry: IT Agency), "Admizz Education" (slug: `admizz`, industry: Education Consultancy), "Mobilise" (slug: `mobilise`, industry: IT Agency, owner `kk@mobilise.agency`)
- Roles: owner, admin, viewer, counselor. As of 2026-06-04 the **Positions/RBAC** feature layers configurable permission profiles on top of `role` (see the `positions` row in `docs/FEATURE-CATALOG.md`); `role` is still the base tier every legacy check reads.
- Default pipeline stages: new / contacted / enrolled / rejected

---

## Credentials

### Dashboard Login
- Email: `admin@zunkireelabs.com`
- Password: `admin123`

### Supabase Projects — TWO separate databases (since 2026-06-21)

**Production** and **dev/staging** now have their own Supabase projects. They no longer share a DB. Always confirm which one you're touching.

| Env | Project ref | URL | Used by |
|---|---|---|---|
| **Production** | `pirhnklvtjjpuvbvibxf` (ap-south-1) | `https://pirhnklvtjjpuvbvibxf.supabase.co` | prod deploy (`lead-crm`/`edgex.zunkireelabs.com`), `docker-compose.prod.yml`, prod VPS `.env.local` |
| **Dev/Staging** | `dymeudcddasqpomfpjvt` | `https://dymeudcddasqpomfpjvt.supabase.co` | `dev-lead-crm.zunkireelabs.com`, `docker-compose.yml`, dev VPS `.env.local`, **local `npm run dev`** |

- **Prod DB connection**: `postgresql://postgres.pirhnklvtjjpuvbvibxf:H2a0r0d0ik%23@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
- **Stage DB connection (direct)**: `postgresql://postgres:Zunkiree%40123%25%5E%26@db.dymeudcddasqpomfpjvt.supabase.co:5432/postgres` (password `Zunkiree@123%^&`)
- **Keys**: in each environment's `.env.local`. The DB pointer lives in **two places per environment** — `docker-compose*.yml` build args (`NEXT_PUBLIC_*`, baked at build) **and** the VPS `.env.local` (`SUPABASE_SERVICE_ROLE_KEY` + the `NEXT_PUBLIC_*` runtime copies). Change both in lockstep or you get a prod/stage split-brain (client one DB, server the other).
- **Stage = sanitized clone of prod** (point-in-time 2026-06-21): identical schema + all rows, but end-customer PII scrubbed and **every auth password reset to `edgexdev123`**. Log into dev/local as any prod email (e.g. `admin@zunkireelabs.com`, `hello@admizz.org`) with password `edgexdev123`.

### Migration workflow (dev-first)

Apply new migrations to **stage** (`dymeudcddasqpomfpjvt`) first → verify on dev/local → then apply to **prod** (`pirhnklvtjjpuvbvibxf`) at promotion time. (Historically migrations hit one shared DB; that's no longer true — a migration is not on prod until you run it on prod.) Apply in a txn with before/after counts, additive-only.

### Production DB changes — per-action approval

The session MAY apply changes (migrations, admin SQL) to the production DB
(`pirhnklvtjjpuvbvibxf`), but only under all of these conditions:
- Brief first: state the exact SQL and expected before/after row counts before running.
- Explicit per-action approval: run only after I say go for that specific change. Never
  standing/blanket approval; never batch multiple prod changes off one go-ahead.
- Additive + reversible: additive-only schema changes, wrapped in a transaction, with
  before/after counts logged. Have a rollback ready.
- Stage first: apply to stage (`dymeudcddasqpomfpjvt`) and verify before touching prod.

This overrides the "prod only at promotion" default: prod changes are allowed mid-work, but
always gated behind an explicit, per-action approval — not run unsupervised.

### Server
- **The ONLY Zunkiree Labs VPS is `root@94.136.189.213`.** There is no other zunkireelabs server.
- **Always connect with `ssh vps`** (alias in `~/.ssh/config`), never the raw IP. The raw IP `ssh root@94.136.189.213` does NOT match the `vps` Host block, so it skips the `~/.ssh/vps_zunkireelabs` identity file and falls back to password auth — which fails non-interactively (e.g. via Claude's `!` prefix).
- IP: `94.136.189.213`
- Domain: `lead-crm.zunkireelabs.com`
- Container: `leads-crm` (Docker + Traefik + Let's Encrypt)
- Paths: prod app at `/home/zunkireelabs/devprojects/lead-gen-crm/`, dev app at `/home/zunkireelabs/devprojects/lead-gen-crm-dev/`

---

## Form Builder Feature (`src/industries/education-consultancy/features/form-builder/`)

Visual form builder, industry-scoped to `education_consultancy`. Admin manages fields and branding; developers control step structure via API/templates.

- **Wizard**: 3-step creation at `/forms/new` (Pick Template → Customize → Publish)
- **Builder**: Split layout with editor (left) + live preview (right) at `/forms/[id]`
- **Templates**: 4 education templates + blank (`src/industries/education-consultancy/features/form-builder/templates/`)
- **Public submit API**: `POST /api/public/submit/[tenantSlug]/[formSlug]` — requires API key (Bearer token), CORS enabled
- **API keys split**: Form keys shown on `/forms`, integration keys on `/settings` — differentiated by `permissions_detail.category`
- **Public forms**: `force-dynamic` — fetches config in real-time from `form_configs` JSONB
- **Industry gate**: all 3 page routes and 3 API routes call `getFeatureAccess(industry, FEATURES.FORM_BUILDER)`; non-education tenants get 404/403.

### Builder UI decisions
- Field editor: Label/Type/Required visible by default, advanced settings behind toggle
- Branding editor: Title/Color/Button visible by default, rest behind "More options"
- Fields reorderable via drag-and-drop (@dnd-kit)
- Step management (add/remove/reorder steps) hidden from admin — developer-controlled
- Inline field label rename via double-click

---

## Known Issues / TODOs

- Next.js 16 "middleware is deprecated" warning — cosmetic only
- No registration page — users created via admin API or email invites
- No pagination on leads table (fine for <1000 leads)
- Webhook dispatcher exists but not fully wired to events (`docs/STATUS-BOARD.md` tracks)
- No email/SMS notifications for lead events
- No self-service tenant onboarding
- ~35 legacy authenticated routes still use raw `createServiceClient()` + manual tenant filter (see `docs/STATUS-BOARD.md` for migration tracking)
- Per-industry AI configs are scaffolded (`src/industries/<id>/ai/agent.ts`) but no real prompts/tools wired yet

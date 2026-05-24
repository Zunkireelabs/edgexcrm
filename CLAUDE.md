# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Git Hooks

A `commit-msg` hook (`.git/hooks/commit-msg`) replaces the default Anthropic co-author line with `Co-Authored-By: Anish Balami <anishbalami38@gmail.com>` on every commit. This hook lives in `.git/hooks/` (not tracked by git) and must be re-created if the repo is re-cloned.

---

## Industry Scoping Rules

The product is an **AI-native operating system per industry tenant**. Each tenant belongs to **exactly one industry** (`tenants.industry_id` — see `supabase/migrations/012_industry_customization.sql` for the 7 seeded industries). The codebase is structured so industry-specific features live in their own modules, universal features stay shared, and multiple developers can work on different industries in parallel without merge conflicts on shared files.

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

### Tenant model

**One tenant = one industry.** Hybrid organizations run multiple tenants under separate logins (matches how Salesforce/HubSpot/Notion handle business units). No multi-industry-per-tenant complexity — it's a deliberate design choice; revisit only if a real customer requests it.

---

## What This Is

Multi-tenant lead generation CRM SaaS (Zunkiree Labs). White-label system where each client (university, business) gets their own tenant with configurable forms, branding, and a dashboard to manage leads.

---

## Read first, every session

1. `docs/SESSION-LOG.md` — current state of the project. The "🟢 NEXT SESSION — RESUME HERE" block at the top tells you exactly where to pick up.
2. `docs/STATUS-BOARD.md` — live status of open user-side actions and questions.
3. `docs/reference/` — stable docs (product vision at `00-PRODUCT-VISION.md`, API contracts under `api-contracts/`). Read for context; don't edit per-task.
4. `docs/archive/` — shipped or superseded work grouped by series (`features/`, `plans/`, `research/`, `ci-cd/`, `stale/`).

**Single source of truth**: `docs/SESSION-LOG.md`. When a piece of work ships, log it there and `git mv` any associated brief into `docs/archive/<series>/`. Top-level `docs/` should only contain SESSION-LOG.md, STATUS-BOARD.md, and any in-flight `<CONTEXT>-BRIEF.md`.

---

## Automatic Skill Routing

**IMPORTANT: This project uses orchestrated development.**

When the user gives ANY development request (build, create, implement, fix, update, change, refactor, feature requests, bug fixes, multi-step work), **automatically invoke `/project-pm`**.

**Exceptions** (do NOT auto-invoke): questions ("How does X work?"), reading ("Show me X"), documentation tasks, direct skill invocation (`/skill-name`), simple one-liner changes.

## Available Skills

| Skill | Domain |
|-------|--------|
| `/project-pm` | Orchestrator for all dev tasks |
| `/crm-expert` | Lead workflows, pipeline design, CRM patterns |
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

**ALL feature branches and PRs MUST merge to `stage` first. NEVER merge directly to `main`.**

```
feature/* ──► stage (staging) ──► main (production)
```

| Trigger | Result |
|---------|--------|
| PR to `main` or `stage` | CI checks (lint, typecheck, build) |
| Push to `stage` | Auto-deploy to `dev-lead-crm.zunkireelabs.com` |
| Push to `main` | Auto-deploy to `lead-crm.zunkireelabs.com` |
| Manual dispatch | Rollback (specific commit) |

```bash
# Before merging ANY PR, verify base branch
gh pr view <num> --json baseRefName  # Must be "stage"

# Deploy staging
git push origin stage

# Deploy production (only after staging verified)
git checkout main && git merge stage && git push origin main

# Monitor
gh run list --limit 5

# Rollback
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

### Migrations

Migrations are in `supabase/migrations/` numbered sequentially (001-018). Applied via Supabase MCP or directly.

### Current Data

- 2 tenants: "Zunkiree Labs" (slug: `zunkireelabs-crm`, industry: IT Agency), "Admizz Education" (slug: `admizz`, industry: Education Consultancy)
- Roles: owner, admin, viewer, counselor
- Default pipeline stages: new / contacted / enrolled / rejected

---

## Credentials

### Dashboard Login
- Email: `admin@zunkireelabs.com`
- Password: `admin123`

### Supabase Project
- **Project ref**: `pirhnklvtjjpuvbvibxf`
- **Region**: ap-south-1
- **URL**: `https://pirhnklvtjjpuvbvibxf.supabase.co`
- **DB connection**: `postgresql://postgres.pirhnklvtjjpuvbvibxf:H2a0r0d0ik%23@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
- **Keys**: in `.env.local`

### Server
- IP: `94.136.189.213`
- Domain: `lead-crm.zunkireelabs.com`
- Container: `leads-crm` (Docker + Traefik + Let's Encrypt)

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

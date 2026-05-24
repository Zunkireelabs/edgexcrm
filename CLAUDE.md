# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Git Hooks

A `commit-msg` hook (`.git/hooks/commit-msg`) replaces the default Anthropic co-author line with `Co-Authored-By: Anish Balami <anishbalami38@gmail.com>` on every commit. This hook lives in `.git/hooks/` (not tracked by git) and must be re-created if the repo is re-cloned.

---

## Industry Feature Development

**Current focus: `education_consultancy` industry only.** Build all new industry-specific features for education_consultancy first.

**Folder convention:** When creating a new feature, create a dedicated folder for it (e.g., `src/features/<feature-name>/`). This makes it easy to replicate the feature for other industries later — just point to the folder.

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

1. **Session-based** (`src/lib/api/auth.ts` → `authenticateRequest()`): For dashboard users. Returns `AuthContext` with `userId`, `tenantId`, `role`. Uses cookies + Supabase Auth.
2. **API key-based** (`src/lib/api/integration-auth.ts`): For external integrations. Bearer tokens prefixed `crm_live_...`, SHA-256 hashed, scope-based permissions.

### API Route Pattern

Most API routes live under `src/app/(main)/api/v1/`. Public submission API at `src/app/api/public/submit/`. Standard pattern:
1. Create request logger with `createRequestLogger()`
2. Authenticate with `authenticateRequest()` (or integration auth)
3. Validate input with `validate()` helpers
4. Use `createServiceClient()` (bypasses RLS) for queries scoped by `auth.tenantId`
5. Return via standardized helpers: `apiSuccess()`, `apiPaginated()`, `apiError()`, `apiUnauthorized()`, etc.

### Counselor Role Scoping

Counselor users are automatically filtered to only their assigned leads. This is enforced in API routes by overriding `assignedTo = auth.userId` when `auth.role === "counselor"`. Must be maintained in any new lead-related endpoints.

### Supabase Client Usage

- **Browser**: `src/lib/supabase/client.ts` → `createBrowserClient()` (respects RLS)
- **Server (user context)**: `src/lib/supabase/server.ts` → `createClient()` (respects RLS, uses cookies)
- **Server (admin)**: `src/lib/supabase/server.ts` → `createServiceClient()` (bypasses RLS, uses service role key)

API routes use `createServiceClient()` and manually scope queries with `auth.tenantId` from the auth context.

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

## Form Builder Feature (`src/features/form-builder/`)

Visual form builder for education_consultancy tenants. Admin manages fields and branding; developers control step structure via API/templates.

- **Wizard**: 3-step creation at `/forms/new` (Pick Template → Customize → Publish)
- **Builder**: Split layout with editor (left) + live preview (right) at `/forms/[id]`
- **Templates**: 4 education templates + blank (`src/features/form-builder/templates/`)
- **Public submit API**: `POST /api/public/submit/[tenantSlug]/[formSlug]` — requires API key (Bearer token), CORS enabled
- **API keys split**: Form keys shown on `/forms`, integration keys on `/settings` — differentiated by `permissions_detail.category`
- **Public forms**: `force-dynamic` — fetches config in real-time from `form_configs` JSONB

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
- Webhook dispatcher exists but not fully wired to events
- No email/SMS notifications for lead events
- No self-service tenant onboarding

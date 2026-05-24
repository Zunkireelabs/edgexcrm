# Lead Gen CRM — Session Log

> Single source of truth for cross-session continuity. Most recent milestone first.

**Project**: Multi-tenant Lead Gen CRM SaaS for Zunkiree Labs
**Status**: Phase 2A complete — verified and passing all 39 tests
**Live**: https://lead-crm.zunkireelabs.com
**Repo**: `Zunkireelabs/edgexcrm` (GitHub)

---

## 🟢 NEXT SESSION — RESUME HERE

- **Current state**: Phase 2A backend (Feb 21) was followed by a long run of unlogged shipped work through May — Phase 2B UI, multi-pipeline, move-to-pipeline, email auto-forward + Gmail OAuth, student check-in, and phone country-code support. See the **Post-Phase 2A backfill** entry below for the *why* on each cluster; `git log` has the *what*.
- **Branch**: `stage` — diverged from `origin/stage` (~3 ahead, 7 behind at last audit). The 7 behind are summarized in the backfill entry; the 3 ahead appear to be minor ci + style fixes. Sort branch state before any new feature work.
- **Untracked**: `PRICING.md` at repo root — duplicate of `docs/reference/PRICING.md`. Delete the root copy or move it; don't commit a duplicate.
- **Next up**: PR #9 ("form builder for education consultancy", merged May 21) needs verification + its own SESSION-LOG entry. After that, Sadin to direct.
- **Blockers**: none known.
- **Open items / questions**: see [STATUS-BOARD.md](./STATUS-BOARD.md).

When closing a session, push this block's content into a new dated session entry below, then refresh this block with the new current state.

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

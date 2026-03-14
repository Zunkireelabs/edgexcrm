# Lead Gen CRM — Zunkiree Labs

Multi-tenant lead generation CRM SaaS product. White-label system where each client (university, business, etc.) gets their own tenant with configurable forms, branding, and a dashboard to manage leads.

---

## Automatic Skill Routing

**IMPORTANT: This project uses orchestrated development.**

### Default: Route Development Tasks to PM

When the user gives ANY development request, **automatically invoke `/project-pm`**.

#### Trigger Patterns (auto-invoke PM):

- "Build/Create/Implement/Add X"
- "Fix/Update/Change/Refactor X"
- Feature requests or bug fixes
- Any multi-step development work

#### Exceptions (do NOT auto-invoke):

- Questions: "How does X work?"
- Reading: "Show me X"
- Documentation tasks
- Direct skill invocation (`/skill-name`)
- Simple one-liner changes explicitly described

---

## Available Skills

| Skill | Domain | When to Use |
|-------|--------|-------------|
| `/project-pm` | **Orchestrator** | All development tasks (routes to specialists) |
| `/db-engineer` | **Database** | Schema, migrations, SQL, RLS, tenant isolation |
| `/frontend-dev` | **Frontend** | Pages, components, forms, layouts, React/shadcn/Tailwind |
| `/api-dev` | **API** | API routes, auth, validation, rate limiting, audit logging |
| `/deploy` | **Deployment** | Docker builds, container restart, health checks, prod troubleshooting |
| `/perf-auditor` | **Performance** | Bundle size, query optimization, caching, React re-renders |
| `/widget-perf` | **Widget Speed** | Embeddable form TTFB, static generation, bundle reduction, embed optimization |
| `/test-engineer` | **Testing** | Unit/integration/component tests, test infrastructure |
| `/security-auditor` | **Security** | RLS review, auth audit, OWASP, tenant isolation verification |
| `/skill-architect` | **Meta** | Create/optimize skills, analyze coverage |

---

## Tech Stack

| Layer | Tech | Version |
|-------|------|---------|
| Framework | Next.js (App Router) | 16.1.6 |
| Language | TypeScript | 5.x |
| UI | Tailwind CSS v4 + shadcn/ui | latest |
| Backend | Supabase (PostgreSQL + Auth + Storage) | JS SDK 2.97 |
| Deployment | Docker + Traefik | Node 22 Alpine |
| React | React 19 | 19.2.3 |

## Live URLs

- **Dashboard**: https://lead-crm.zunkireelabs.com
- **Login**: https://lead-crm.zunkireelabs.com/login
- **Public Form (RKU)**: https://lead-crm.zunkireelabs.com/form/rku

## Credentials

### Dashboard Login
- Email: `admin@zunkireelabs.com`
- Password: `admin123`

### Supabase Project
- **Project ref**: `pirhnklvtjjpuvbvibxf`
- **Region**: Asia-Pacific (ap-south-1)
- **URL**: `https://pirhnklvtjjpuvbvibxf.supabase.co`
- **DB connection**: `postgresql://postgres.pirhnklvtjjpuvbvibxf:H2a0r0d0ik%23@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`
- **Keys**: in `.env.local` (anon key + service role key)

### Server
- IP: `94.136.189.213`
- Domain: `lead-crm.zunkireelabs.com`
- Container: `leads-crm` (Docker, Traefik reverse proxy, Let's Encrypt SSL)

## Project Structure

```
lead-gen-crm/
├── .claude/
│   ├── settings.local.json         # MCP + permissions
│   └── skills/
│       ├── api-dev/SKILL.md        # API route specialist
│       ├── db-engineer/SKILL.md    # DB engineer skill
│       ├── deploy/SKILL.md         # Deployment specialist
│       ├── frontend-dev/SKILL.md   # Frontend specialist
│       ├── perf-auditor/SKILL.md   # Performance auditor
│       ├── project-pm/SKILL.md     # Orchestrator / team lead
│       ├── security-auditor/SKILL.md # Security auditor
│       ├── skill-architect/SKILL.md # Skill creation expert
│       ├── test-engineer/SKILL.md  # Test engineer
│       └── widget-perf/SKILL.md    # Widget performance optimizer
├── .mcp.json                       # Supabase MCP server config
├── .env.local                      # Supabase keys (DO NOT COMMIT)
├── .env.example                    # Template for .env.local
├── docker-compose.yml              # Traefik deployment config
├── Dockerfile                      # Multi-stage Node 22 Alpine build
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql          # Core multi-tenant schema + RLS
│       ├── 002_phase1_5_foundation.sql     # Soft deletes, audit logs, events, pipeline stages
│       ├── 003_phase2a_saas_ops.sql        # Stage/assignment on leads, invites, checklists
│       ├── 004_custom_fields_gin_index.sql # GIN index on custom_fields JSONB
│       ├── 005_integration_keys.sql        # API key auth for integrations
│       ├── 006_webhook_system.sql          # Webhook endpoints + delivery tracking
│       ├── 007_integration_permissions.sql # Scope-based permissions + idempotency
│       └── 008_integration_keys_last_used.sql # Last used tracking
├── src/
│   ├── middleware.ts                # Auth route protection
│   ├── types/database.ts           # All TypeScript types
│   ├── lib/
│   │   ├── utils.ts                # shadcn cn() helper
│   │   ├── logger.ts              # pino structured logging
│   │   ├── api/
│   │   │   ├── auth.ts            # Session-based auth (AuthContext)
│   │   │   ├── integration-auth.ts # API key auth (Bearer crm_live_...)
│   │   │   ├── integration-helpers.ts # Shared integration utilities
│   │   │   ├── integration-permissions.ts # Scope-based permission checks
│   │   │   ├── response.ts        # Standardized JSON responses
│   │   │   ├── validation.ts      # Request body validation
│   │   │   ├── audit.ts           # Audit log + event emission
│   │   │   └── rate-limit.ts      # In-memory rate limiting
│   │   ├── security/
│   │   │   └── api-key.ts         # Key generation + SHA-256 hashing
│   │   ├── webhooks/
│   │   │   └── dispatcher.ts      # Webhook delivery with HMAC signatures
│   │   └── supabase/
│   │       ├── client.ts           # Browser client (createBrowserClient)
│   │       ├── server.ts           # Server client + service role client
│   │       ├── middleware.ts       # Session refresh middleware
│   │       └── queries.ts          # Reusable server-side queries
│   ├── components/
│   │   ├── ui/                     # shadcn/ui components (15+ components)
│   │   ├── dashboard/
│   │   │   ├── shell.tsx           # Sidebar + header layout
│   │   │   ├── stats-cards.tsx     # 5 stat cards (total/new/contacted/enrolled/rejected)
│   │   │   ├── leads-table.tsx     # Searchable, filterable leads table + CSV export
│   │   │   ├── lead-detail.tsx     # Lead view with status update, notes, checklists, docs
│   │   │   ├── settings-form.tsx   # Tenant settings + embed code generator
│   │   │   ├── api-keys-manager.tsx # API key create/revoke/test
│   │   │   ├── team-management.tsx # Invite users, manage roles
│   │   │   └── pipeline/
│   │   │       ├── PipelineBoard.tsx  # Kanban drag-and-drop (dnd-kit)
│   │   │       ├── PipelineColumn.tsx # Stage column
│   │   │       └── LeadCard.tsx       # Lead card in pipeline
│   │   └── form/
│   │       └── public-form.tsx     # Multi-step dynamic form with file uploads
│   └── app/
│       ├── layout.tsx              # Root layout with Toaster
│       ├── page.tsx                # Root redirect (→ /dashboard or /login)
│       ├── globals.css             # Tailwind + shadcn theme variables
│       ├── (auth)/
│       │   └── login/page.tsx      # Login page (Supabase Auth)
│       ├── (dashboard)/
│       │   ├── layout.tsx          # Protected layout (checks auth + tenant)
│       │   ├── dashboard/page.tsx  # Stats + leads table
│       │   ├── leads/page.tsx      # All leads page
│       │   ├── leads/[id]/page.tsx # Lead detail page
│       │   ├── pipeline/page.tsx   # Kanban pipeline view
│       │   ├── team/page.tsx       # Team management
│       │   └── settings/page.tsx   # Tenant settings + API keys
│       ├── form/[slug]/page.tsx    # Public form (per-tenant by slug)
│       └── api/
│           ├── auth/callback/route.ts      # Supabase auth callback
│           └── v1/
│               ├── leads/route.ts          # List + create leads
│               ├── leads/[id]/route.ts     # Get + update + delete lead
│               ├── leads/[id]/checklists/  # Checklist CRUD
│               ├── upload/route.ts         # File upload
│               ├── team/route.ts           # Team members
│               ├── invites/route.ts        # Invite management
│               ├── settings/api-keys/      # API key management
│               └── integrations/crm/       # External integration API (10 endpoints)
```

## Database Schema

### Tables (15 total)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tenants` | Client organizations | id, name, slug, primary_color, config (JSONB) |
| `tenant_users` | User→tenant mapping | tenant_id, user_id, role (owner/admin/viewer/counselor) |
| `form_configs` | Configurable forms per tenant | steps (JSONB), branding (JSONB), redirect_url |
| `leads` | Lead submissions | tenant_id, status, stage_id, assigned_to, custom_fields (JSONB), file_urls (JSONB), deleted_at |
| `lead_notes` | Internal notes | lead_id, user_id, content |
| `lead_checklists` | Task items per lead | lead_id, title, is_completed, completed_by |
| `pipeline_stages` | Custom stages per tenant | tenant_id, name, slug, position, color, is_terminal |
| `audit_logs` | Action tracking | tenant_id, user_id, action, entity_type, entity_id, changes (JSONB) |
| `events` | Async event queue | tenant_id, type, entity_type, payload, status |
| `invite_tokens` | Email invitations | tenant_id, email, role, token, expires_at |
| `integration_keys` | API key auth | tenant_id, name, hashed_key, permissions[], last_used_at |
| `integration_idempotency` | Dedup tracking | tenant_id, idempotency_key, endpoint, response (JSONB) |
| `webhook_endpoints` | Tenant webhook URLs | tenant_id, url, secret, event_types[] |
| `webhook_deliveries` | Delivery audit log | endpoint_id, status_code, response_body, retry_count |
| `rate_limits` | Rate limit tracking | — |

### Storage
- Bucket: `lead-documents` (public read, anon upload)

### RLS Architecture

**IMPORTANT**: RLS uses two `SECURITY DEFINER` functions to avoid infinite recursion:
- `get_user_tenant_ids()` — returns tenant IDs for current auth user
- `is_tenant_admin(tenant_id)` — checks if current user is owner/admin of a tenant

These functions bypass RLS internally since `tenant_users` policies can't reference `tenant_users` itself. All other table policies call these functions instead of subquerying `tenant_users` directly.

### RLS
- **33 policies** across all 15 tables
- **5 helper functions**: `get_user_tenant_ids()`, `is_tenant_admin()`, `get_user_tenant_role()`, `update_updated_at()`, `rls_auto_enable()`

### Current Data
- 2 tenants: "RK University" (slug: `rku`), "Admizz Education" (slug: `admizz`)
- 4 tenant users (including `admin@zunkireelabs.com` as owner)
- 2 form configs (one per tenant)
- 40 leads
- 4 default pipeline stages per tenant: new / contacted / enrolled / rejected

## Key Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Deploy (rebuild + restart container)
cd /home/zunkireelabs/devprojects/lead-gen-crm
docker compose up -d --build

# View container logs
docker logs leads-crm

# Database access
psql "postgresql://postgres.pirhnklvtjjpuvbvibxf:H2a0r0d0ik#@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"
```

## Architecture Decisions

1. **`custom_fields` JSONB** on leads — instead of fixed columns per client, extra form fields go into a JSONB column. This means adding a new field for a client doesn't require a schema migration.

2. **`form_configs.steps` JSONB** — the entire form structure (fields, validation, conditional visibility) is stored as JSON. The `public-form.tsx` component renders dynamically from this config.

3. **Server Components for data fetching** — dashboard pages are Server Components that fetch data, then pass it to Client Components for interactivity.

4. **`SECURITY DEFINER` functions for RLS** — PostgreSQL RLS policies on `tenant_users` can't subquery `tenant_users` without infinite recursion. The helper functions run with definer privileges (bypassing RLS) to break the cycle.

5. **Supabase Auth (not custom)** — real JWT-based auth with proper session management, replacing the hardcoded credentials from the original RKU project.

6. **Soft deletes** on leads — `deleted_at` column instead of hard deletes; all queries filter `WHERE deleted_at IS NULL`.

7. **Bearer API keys for integrations** — stateless `crm_live_...` keys with SHA-256 hashing, constant-time comparison, scope-based permissions (read/write/admin).

8. **Idempotency tracking** — `idempotency_key` on leads + `integration_idempotency` table prevent duplicate submissions.

9. **Counselor role scoping** — counselor users automatically filtered to only their assigned leads across all views.

10. **Event-driven audit** — `audit_logs` + `events` tables decouple mutations from side effects (webhooks, notifications).

## Known Issues / TODOs

- Next.js 16 shows "middleware is deprecated, use proxy" warning — cosmetic only, middleware still works
- Registration page not built yet — users created via Supabase Admin API or email invites
- Settings page: form field editor not built — form configs currently seeded via SQL
- No pagination on leads table — loads all leads client-side (fine for <1000 leads)
- Phone validation in public form is basic regex — could be improved per-country
- Webhook dispatcher infrastructure exists but not fully wired to events
- No email/SMS notifications for lead events or team invites
- No self-service tenant onboarding — tenants created manually
- No advanced reporting/analytics beyond stats cards + CSV export

## Origin

This project was built by converting the single-client RKU scholarship lead system at `/home/zunkireelabs/devprojects/hardik-dev-space/rku-dev/rku-form-prep/` into a scalable multi-tenant product. The original was static HTML + vanilla JS + Supabase with hardcoded credentials. This version uses proper auth, multi-tenancy, and modern React.

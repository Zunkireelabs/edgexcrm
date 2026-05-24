# Lead Gen CRM — Product Roadmap

> Last updated: 2026-03-14

## Current State

The CRM is **live in production** with 2 tenants (RKU, Admizz), 40 leads, and 4 users. Core features — multi-tenant dashboard, pipeline kanban, public forms, team management, and integration API — are all shipped and working.

**What's been built (8 migration phases):**

| Phase | What | Status |
|-------|------|--------|
| 1.0 | Core multi-tenant schema + RLS + auth + dashboard + public forms | Done |
| 1.5 | Soft deletes, audit logs, events table, pipeline stages | Done |
| 2A | Stage/assignment on leads, invites, checklists, counselor role | Done |
| 2B | GIN index on custom_fields for fast JSONB queries | Done |
| 3A | Integration API keys (SHA-256 hash, constant-time verify) | Done |
| 3B | Webhook system (endpoints + delivery tracking tables) | Done |
| 3C | Scope-based permissions + idempotency tracking | Done |
| 3D | API key last_used_at tracking | Done |
| — | Pipeline kanban UI (drag-and-drop, dnd-kit) | Done |
| — | Team management UI (invites, roles) | Done |
| — | API keys management UI (create, revoke, test) | Done |
| — | Integration API (10 CRM endpoints for Orca agent) | Done |
| — | API docs (frozen v1.0 spec, OpenAPI, Postman) | Done |

---

## Roadmap

### Phase 4 — UX Polish & Core Gaps

> Priority: **High** — These are gaps that affect daily usability for existing tenants.

#### 4.1 — Form Builder UI
- **What**: Visual drag-and-drop form editor in Settings page
- **Why**: Currently form configs are seeded via SQL — tenant admins can't modify their own forms
- **Scope**: Add/remove/reorder fields, configure validation rules, preview form, save to form_configs
- **Depends on**: Nothing (pure frontend)

#### 4.2 — Server-Side Pagination
- **What**: Paginate leads table, pipeline view, and API responses
- **Why**: Current client-side loading breaks at scale (>1000 leads)
- **Scope**: Cursor or offset pagination on `/api/v1/leads`, update LeadsTable + PipelineBoard
- **Depends on**: Nothing

#### 4.3 — Dashboard Analytics
- **What**: Date-range filters, trend charts, source breakdown, conversion funnel
- **Why**: Stats cards show totals only — no way to see trends or filter by time period
- **Scope**: Chart library (recharts or similar), date picker, API for aggregated stats
- **Depends on**: Nothing

#### 4.4 — Notification System
- **What**: Email notifications for key events (new lead, assignment, status change, invite)
- **Why**: Team members have no way to know when things happen without checking the dashboard
- **Scope**: Email provider integration (Resend/SendGrid), notification preferences per user
- **Depends on**: Events table (already exists)

---

### Phase 5 — Self-Service & Growth

> Priority: **Medium** — Needed for scaling beyond manually onboarded tenants.

#### 5.1 — Tenant Onboarding Flow
- **What**: Self-service signup → create tenant → configure branding → deploy form
- **Why**: Currently tenants are created manually via SQL/admin
- **Scope**: Registration page, tenant creation wizard, default form template, Stripe integration (optional)
- **Depends on**: Nothing

#### 5.2 — Webhook Delivery Integration
- **What**: Wire the existing webhook dispatcher to the events table
- **Why**: Infrastructure exists (tables, dispatcher, HMAC signing) but events aren't consumed
- **Scope**: Event consumer/worker, retry logic, delivery dashboard in Settings
- **Depends on**: Nothing (infrastructure already built)

#### 5.3 — Settings Page Completion
- **What**: Full tenant settings — branding editor, custom domain config, email templates
- **Why**: Settings page is partially built (read-only for most fields)
- **Scope**: Logo upload, color picker, custom thank-you page, form embed code generator
- **Depends on**: Nothing

#### 5.4 — Lead Import/Export
- **What**: Bulk CSV import, advanced export with field selection
- **Why**: Tenants need to migrate existing leads into the CRM and export for reporting
- **Scope**: CSV parser, field mapping UI, validation, progress tracking
- **Depends on**: Nothing

---

### Phase 6 — Advanced Features

> Priority: **Medium-Low** — Differentiators for competitive positioning.

#### 6.1 — Communication Log
- **What**: Track calls, emails, WhatsApp messages per lead
- **Why**: Counselors need a timeline of all interactions, not just notes
- **Scope**: New `communications` table, timeline UI in lead detail, optional email/WhatsApp integration
- **Depends on**: DB migration

#### 6.2 — Automated Lead Routing
- **What**: Rules engine to auto-assign leads based on source, location, score, or round-robin
- **Why**: Manual assignment doesn't scale with high lead volume
- **Scope**: Routing rules config per tenant, auto-assignment on lead creation
- **Depends on**: Nothing

#### 6.3 — Lead Scoring
- **What**: Configurable scoring model (field weights, activity-based)
- **Why**: Helps counselors prioritize high-potential leads
- **Scope**: Score calculation on lead create/update, sortable in table/pipeline, config in settings
- **Depends on**: Nothing

#### 6.4 — Multi-Form Support
- **What**: Multiple active forms per tenant (scholarship form, inquiry form, event registration)
- **Why**: Currently one form_config per tenant — real-world tenants need multiple intake forms
- **Scope**: Form list in settings, form selector, separate URLs per form
- **Depends on**: Form Builder UI (4.1)

#### 6.5 — Reporting & Exports
- **What**: Custom report builder, scheduled reports, PDF generation
- **Why**: Management needs periodic reports without manual CSV work
- **Scope**: Report templates, date ranges, grouping, PDF export, email scheduling
- **Depends on**: Dashboard Analytics (4.3)

---

### Phase 7 — Scale & Enterprise

> Priority: **Low** — Enterprise readiness features for larger deployments.

#### 7.1 — Multi-Language Forms
- **What**: Internationalized public forms (i18n)
- **Why**: Tenants operating in non-English markets
- **Scope**: Translation config in form_configs, language selector on public form

#### 7.2 — Custom Domains
- **What**: Tenants can use their own domain for forms (e.g., `apply.rkuniversity.edu`)
- **Why**: White-label requirement for enterprise clients
- **Scope**: DNS verification, SSL provisioning, Traefik dynamic config

#### 7.3 — Audit Dashboard
- **What**: Admin UI to browse audit_logs — who did what, when
- **Why**: Compliance and accountability for enterprise tenants
- **Scope**: Searchable/filterable audit log viewer, export capability

#### 7.4 — Role-Based Permissions (Granular)
- **What**: Fine-grained permissions beyond owner/admin/counselor/viewer
- **Why**: Larger teams need custom permission sets
- **Scope**: Permission matrix, custom roles, per-feature access control

#### 7.5 — SSO / OAuth
- **What**: SAML/OAuth login for enterprise tenants
- **Why**: Enterprise clients require SSO integration
- **Scope**: Supabase Auth provider config, tenant-level SSO settings

---

## Implementation Priority Matrix

```
                    HIGH IMPACT
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         │  4.1 Form    │  4.4 Notif.  │
         │  Builder     │              │
         │              │  5.1 Onboard │
         │  4.3 Charts  │              │
    LOW ─┼──────────────┼──────────────┼─ HIGH
  EFFORT │              │              │  EFFORT
         │  4.2 Paging  │  6.1 Comms   │
         │              │              │
         │  5.2 Webhooks│  7.2 Domains │
         │  5.3 Settings│              │
         │              │              │
         └──────────────┼──────────────┘
                        │
                    LOW IMPACT
```

**Recommended build order:**
1. 4.2 (Pagination) — quick win, prevents scaling issues
2. 4.1 (Form Builder) — biggest usability gap
3. 4.4 (Notifications) — critical for team workflows
4. 5.2 (Webhooks) — low effort, infrastructure already exists
5. 4.3 (Analytics) — high value for tenant admins
6. 5.1 (Onboarding) — unlocks growth
7. Everything else based on client demand

---

## Technical Debt

| Item | Severity | Notes |
|------|----------|-------|
| No pagination | Medium | Client-side load of all leads; breaks at scale |
| Webhook dispatcher not wired | Low | Infrastructure ready, just needs event consumer |
| CLAUDE.md was stale | Fixed | Updated 2026-03-14 with accurate table/data counts |
| No automated tests | Medium | No unit/integration/e2e tests exist |
| In-memory rate limiting | Low | Resets on server restart; fine for single-instance |
| No CI/CD pipeline | Medium | Manual `docker compose up -d --build` deploys |

---

## Files

- [Phase 4 — UX Polish & Core Gaps](./phase-4-ux-polish.md)
- [Phase 5 — Self-Service & Growth](./phase-5-self-service.md)
- [Phase 6 — Advanced Features](./phase-6-advanced.md)
- [Phase 7 — Scale & Enterprise](./phase-7-enterprise.md)

> Detailed phase documents will be created as each phase begins.

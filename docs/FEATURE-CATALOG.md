# Feature Catalog

> Human-readable view of every feature in the codebase, where it lives, and which industries use it. Auto-generation script is a future improvement; for now this is maintained by hand alongside `src/industries/_registry.ts`.

Last updated: 2026-05-29 evening (Account 360° detail page shipped to stage `d1a4b89`. Production HEAD still at `f9af70d` — stage leads main by Contact 360 + Sidebar nav grouping + Account 360 + polish + docs.)

---

## How to read this

Every feature is classified as one of:
- **Global** — used by every tenant regardless of industry. Lives outside `src/industries/`.
- **Industry-aware** — used by every tenant but adapts labels/behavior per industry.
- **Industry-scoped** — only available to tenants in the listed industries. Lives in `src/industries/<id>/features/`.
- **Shared** — used by multiple industries but not all. Lives in `src/industries/_shared/features/`.

When adding or moving features, update this table and the constants in `src/industries/_registry.ts`. CLAUDE.md § Industry Scoping Rules has the decision tree.

---

## Global

| ID | Location | Notes |
|---|---|---|
| `leads` | `src/app/(main)/(dashboard)/leads/` + `src/components/dashboard/leads-table.tsx`, `lead-detail.tsx` | All tenants. |
| `pipeline` | `src/app/(main)/(dashboard)/pipeline/` + `src/components/pipeline/` | Multi-pipeline support. |
| `team` | `src/app/(main)/(dashboard)/team/` + `src/components/dashboard/team-management.tsx` | Invites, roles, removals. |
| `settings` | `src/app/(main)/(dashboard)/settings/` + `src/components/dashboard/settings/` | Tenant settings, API keys, email rules. |
| `dashboard` | `src/app/(main)/(dashboard)/dashboard/` + `src/components/dashboard/stats-cards.tsx` | Stats overview. |
| `notifications` | `src/app/(main)/api/v1/notifications/` + `src/components/dashboard/notifications-dropdown.tsx` | In-app notifications. |
| `ai-chat` | `src/app/(main)/api/v1/ai/chat/` + `src/components/dashboard/ai-assistant/` | Placeholder; per-industry prompts come later. |
| `email-rules` | `src/components/dashboard/settings/email-rules-manager.tsx` + `/api/v1/settings/email-rules/` | Gmail auto-forward. |
| `lead-activities` | `/api/v1/leads/[id]/activities/` | Calls, emails, meetings. |
| `lead-insights` | `/api/v1/leads/[id]/insights/` | AI scoring (scaffolded). |

## Industry-aware

| ID | Location | Adapts by industry | Notes |
|---|---|---|---|
| `default-pipeline-stages` | DB seed in `industries.default_pipeline_stages` | Yes — each industry seeds different stages on new pipelines | Read by pipeline create flow. |
| `industry-entities` | `src/components/dashboard/settings/industry-entities-manager.tsx` | Yes — label changes per industry (Partner Colleges, Services, Project Types, etc.) | Only renders if `tenant.industry_id` is set. |

## Industry-scoped

| Registry ID | Location | Industries | Notes |
|---|---|---|---|
| `FEATURES.CHECK_IN` (`check-in`) | `src/industries/education-consultancy/features/check-in/` | `education_consultancy` | Student check-in with search + history + per-student detail. Gated at sidebar, page (`/check-in`, `/check-in/[id]`), and 4 API routes. |
| `FEATURES.FORM_BUILDER` (`form-builder`) | `src/industries/education-consultancy/features/form-builder/` | `education_consultancy` | Visual form builder + templates + public submit API. Gated at sidebar, 3 page routes (`/forms`, `/forms/new`, `/forms/[id]`), and 3 API routes. |
| `FEATURES.CRM_CONTACTS` (`crm-contacts`) | `src/industries/it-agency/features/crm-contacts/` | `it_agency` | CRM Contacts — people at B2B accounts. Full CRUD (Phase B): contacts list + detail + ContactForm dialog + ContactStatusBadge. 6 API routes (list, create, get, patch, soft-delete, by-account). Soft-delete clears `accounts.primary_contact_id`. Primary contact pill on AccountDetailPage. Project↔contact junction wiring (Phase C): 2 symmetric API routes (`contacts/[id]/projects` POST/PATCH/DELETE + `projects/[id]/contacts` GET/POST/PATCH/DELETE), Projects section on contact-detail, Contacts section on project-detail, `ProjectContactPicker` dialog. Primary-contact-per-project enforced at DB (partial unique index) + 409 PRIMARY_TAKEN in API. Lead → Contact conversion (Phase D): `POST /api/v1/leads/[id]/convert` with TOCTOU-safe atomic update (same pattern as time-entries approve/reject — `.is("converted_at", null)` precondition + orphan contact cleanup on race-loss + 409). `ConvertLeadDialog` on `lead-detail-v2.tsx` defaults to "use existing account" pre-selected when `lead.account_id` is set, "create new" otherwise. NO_ACCOUNT sentinel for the Radix Select. Counselor scoping enforced server-side; `contact.assigned_to` mirrors lead. Cross-cutting `converted_at IS NULL` filter added to all default leads-fetching surfaces (queries.ts `getLeads`/`getLeadsForPipeline`/pipeline counts, `/api/v1/leads` GET, `/api/v1/accounts/[id]/leads` GET, `/api/v1/pipelines` GET, `/api/v1/pipelines/[id]` GET per-stage counts, leads bulk verification reads) with optional `?include_converted=1` flag for future archive view. `getLead()` and `/api/v1/leads/[id]` GET intentionally NOT filtered — preserves read-only access to converted leads via "Converted to <contact>" link pill on the original lead. Phase E (2026-05-27): 20-step smoke matrix run end-to-end (13/13 admin API + 4/4 counselor + Admizz + 3 visual); zero bugs surfaced; CRM Contacts v1 closed. |
| `FEATURES.ACCOUNTS` (`accounts`) | `src/industries/it-agency/features/accounts/` | `it_agency` | B2B accounts (agencies/employers) with linked projects and leads. Gated at sidebar, 2 page routes (`/accounts`, `/accounts/[id]`), and 7 API routes (accounts, projects, tasks). **2026-05-29 evening**: `/accounts/[id]` rewritten as a 3-column **workspace 360° page** (`d1a4b89`, squash from `feat/account-detail-360`). CRM-expert-informed PSA framing (not Contact-360 symmetric): right column work-status-first (HealthSnapshotCard with project-status dot row + conditional OpenLeadsCard; no Lead Provenance card — dropped because lead-to-account lacks the 1:1 mapping); Primary Contact promoted to left header (identity attribute); middle column = 5-tab strip (Overview · Projects · Contacts wired; Activity + Billing disabled "Coming soon"). 10 new subcomponents under `components/account-detail/`. Backend extends GET `/api/v1/accounts/[id]` with `owner_email` (raw().auth.admin.getUserById), `project_status_mix` (6-key count reduced in app code), `open_leads_count` (exact HEAD count) via Promise.all. Cross-cutting: `PROJECT_STATUS_MAP` exported from `time-tracking/status-badge` as single label source-of-truth. V2 deferrals: billable hrs this month + lifetime billable $ + Account Team card + Activity tab content + Billing tab content + last_activity_at + project-status pie chart + at-risk health score + MRR/retainer model. |
| `FEATURES.PROJECT_BOARD` (`project-board`) | `src/industries/it-agency/features/project-board/` | `it_agency` | Unified Project Workspace at `/projects` — admin-only v1. Four views over the same dataset with lifted, URL-encoded filters: **Board** (kanban with drag-drop + TOCTOU `expected_status` precondition + card metrics), **Table** (sortable columns + inline owner/status editors), **Tasks** (cross-project shadcn Table with 8 sortable columns + inline edits for status/assignee/priority/due/tags + log-time-from-row pre-filling LogTimeDialog), **Members** (one section per team-member-with-work; non-N+1 aggregation ≤3 requests; expand/collapse persists). Migration 024 adds `tasks.assignee_id` + `due_date` + `priority` + `tags TEXT[]`, plus `projects.owner_id` + `accounts.owner_id` and 6 indexes. New `GET /api/v1/tasks` cross-project endpoint (FEATURES.PROJECT_BOARD gate, counselor-scoped `assignee_id = auth.userId`, paginated max 200, filters: project/account/assignee/status/priority/tags/due/q). New `GET /api/v1/tasks/tags` for tenant-wide tag pool. `PATCH /api/v1/tasks/[id]` extended (assignee_id + due_date + priority + tags, back-compat via `"key" in body` for nullable fields). Tag UX is a Notion-style `<TagMultiPicker>` (search + autofocus + checkable rows + Create-new fallback + case-insensitive duplicate guard); used in both per-task and per-filter surfaces; ANY-match filter semantics via `.overlaps()`. Phase 5 polish: keyboard shortcuts (`b`/`t`/`k`/`m` for views, `/` focus search, `Esc` clear), per-view empty states with Clear-filters CTA, comprehensive a11y attributes, single `router.replace({ scroll: false })` in `use-workspace-filters.ts` so deep links and keyboard nav never jump scroll. Counselor scoping enforced on /api/v1/tasks (own-assignee filter). Admizz tenant: sidebar item absent, `/projects` 404, API 403. |
| `FEATURES.TIME_TRACKING` (`time-tracking`) | `src/industries/it-agency/features/time-tracking/` | `it_agency` | Time entries + approvals + billable totals. Gated at sidebar, 3 page routes (`/time-tracking`, `/time-tracking/projects/[id]`, `/time-tracking/approvals`), and 6 API routes (time-entries + approve/reject + summary). Phase 5 (2026-05-27): rates + billable totals close v1. `lib/rates.ts` (`resolveEffectiveRate`: project default_rate → member default_hourly_rate → 0) + `lib/totals.ts` (`calculateBillableMinutes`/`calculateBillableAmount`, filtered to is_billable + approval_status='approved'; uses `rate_snapshot` so historical invoices stay immutable). Atomic `rate_snapshot` on approval: parallel fetch project + member rates → compute in app code → single atomic UPDATE with the existing TOCTOU `.eq("approval_status", "pending")` precondition preserved. Team route `/api/v1/team` PATCH plumbs `default_hourly_rate` (admin-only, validates ≥0 or null; not industry-gated because the column is on a universal table). Shared `RateInput` component (`$`-prefixed numeric) used by `ProjectForm` (in `accounts/`); inline rate editor on `/team` gated to it_agency via `showRates = industryId === "it_agency"`. `/api/v1/time-entries/summary?dimension=member|project|account&from=&to=` with counselor scoping (non-admins query-filtered to own user_id + group-level safety net for dim=member). Billable totals UI: project-detail card above Contacts section, approvals-queue projected `$X.XX @ $Y/hr` per pending row, "Billable $" tile on the home stats strip. |

## Shared

_(Empty today — no cross-industry shared features exist yet. The first one arrives when a 2nd industry wants something that already exists in another industry; promote it via `_shared/` rather than copy-paste.)_

---

## Industries

| ID | Name | Tenant today | Manifest |
|---|---|---|---|
| `education_consultancy` | Education Consultancy | Admizz Education (slug: `admizz`) | `src/industries/education-consultancy/manifest.ts` |
| `it_agency` | IT Agency | Zunkiree Labs (slug: `zunkireelabs-crm`) | `src/industries/it-agency/manifest.ts` — Contacts, Accounts, Time Tracking, Project Workspace |
| `construction` | Construction | — | `src/industries/construction/manifest.ts` (empty stub) |
| `real_estate` | Real Estate | — | `src/industries/real-estate/manifest.ts` (empty stub) |
| `healthcare` | Healthcare | — | `src/industries/healthcare/manifest.ts` (empty stub) |
| `recruitment` | Recruitment | — | `src/industries/recruitment/manifest.ts` (empty stub) |
| `general` | General | — | `src/industries/general/manifest.ts` (empty stub) |

---

## Workflow reminders

- New feature for one industry only? → `src/industries/<id>/features/<feature>/` + add to `_registry.ts` + register in `<id>/manifest.ts`.
- Need an existing feature in a 2nd industry? → `git mv` to `_shared/`, opt-in via both manifests. **Never copy-paste.**
- Universal feature? → `src/app/(main)/(dashboard)/<feature>/` — no manifest changes.

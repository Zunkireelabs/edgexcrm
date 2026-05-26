# Feature Catalog

> Human-readable view of every feature in the codebase, where it lives, and which industries use it. Auto-generation script is a future improvement; for now this is maintained by hand alongside `src/industries/_registry.ts`.

Last updated: 2026-05-26 (Phase C)

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
| `FEATURES.CRM_CONTACTS` (`crm-contacts`) | `src/industries/it-agency/features/crm-contacts/` | `it_agency` | CRM Contacts — people at B2B accounts. Full CRUD (Phase B): contacts list + detail + ContactForm dialog + ContactStatusBadge. 6 API routes (list, create, get, patch, soft-delete, by-account). Soft-delete clears `accounts.primary_contact_id`. Primary contact pill on AccountDetailPage. Project↔contact junction wiring (Phase C): 2 symmetric API routes (`contacts/[id]/projects` POST/PATCH/DELETE + `projects/[id]/contacts` GET/POST/PATCH/DELETE), Projects section on contact-detail, Contacts section on project-detail, `ProjectContactPicker` dialog. Primary-contact-per-project enforced at DB (partial unique index) + 409 PRIMARY_TAKEN in API. Lead → Contact conversion (Phase D): `POST /api/v1/leads/[id]/convert` with TOCTOU-safe atomic update (same pattern as time-entries approve/reject — `.is("converted_at", null)` precondition + orphan contact cleanup on race-loss + 409). `ConvertLeadDialog` on `lead-detail-v2.tsx` defaults to "use existing account" pre-selected when `lead.account_id` is set, "create new" otherwise. NO_ACCOUNT sentinel for the Radix Select. Counselor scoping enforced server-side; `contact.assigned_to` mirrors lead. Cross-cutting `converted_at IS NULL` filter added to all default leads-fetching surfaces (queries.ts `getLeads`/`getLeadsForPipeline`/pipeline counts, `/api/v1/leads` GET, `/api/v1/accounts/[id]/leads` GET, `/api/v1/pipelines` GET, `/api/v1/pipelines/[id]` GET per-stage counts, leads bulk verification reads) with optional `?include_converted=1` flag for future archive view. `getLead()` and `/api/v1/leads/[id]` GET intentionally NOT filtered — preserves read-only access to converted leads via "Converted to <contact>" link pill on the original lead. Phase E (polish/full-smoke-matrix) pending. |
| `FEATURES.ACCOUNTS` (`accounts`) | `src/industries/it-agency/features/accounts/` | `it_agency` | B2B accounts (agencies/employers) with linked projects and leads. Gated at sidebar, 2 page routes (`/accounts`, `/accounts/[id]`), and 7 API routes (accounts, projects, tasks). |
| `FEATURES.TIME_TRACKING` (`time-tracking`) | `src/industries/it-agency/features/time-tracking/` | `it_agency` | Time entries + approvals + billable totals. Gated at sidebar, 3 page routes (`/time-tracking`, `/time-tracking/projects/[id]`, `/time-tracking/approvals`), and 5 API routes (time-entries + approve/reject). |

## Shared

_(Empty today — no cross-industry shared features exist yet. The first one arrives when a 2nd industry wants something that already exists in another industry; promote it via `_shared/` rather than copy-paste.)_

---

## Industries

| ID | Name | Tenant today | Manifest |
|---|---|---|---|
| `education_consultancy` | Education Consultancy | Admizz Education (slug: `admizz`) | `src/industries/education-consultancy/manifest.ts` |
| `it_agency` | IT Agency | Zunkiree Labs (slug: `zunkireelabs-crm`) | `src/industries/it-agency/manifest.ts` — Contacts, Accounts, Time Tracking |
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

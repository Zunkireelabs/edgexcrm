# Account detail page — Workspace 360° redesign

> Restructure `/accounts/[id]` from a single-column form view into a 3-column "workspace 360°" page. Account is the umbrella over Contacts + Projects + Leads — so the page is **work-status-first**, not people-first. Mirrors the Contact-360 shell, but the middle column uses tabs because accounts aggregate over more entities. UI restructure + 3 small backend additions; no DB migrations in v1.

---

## Goal

Today's `/accounts/[id]` is a single-column-ish layout: back nav + name + Active/Inactive badge + primary-contact picker, then a Contacts list, then a 2/3+1/3 grid (Projects + Lead contacts). Functional but reads as a form, not a workspace.

The user wants `/accounts/[id]` to match the substance of `/contacts/[id]` (just shipped) and `/leads/[id]` v2. Same 3-column shell, **different middle-column treatment** (tabs vs stacked sections) and **different right-column framing** (work-status-first, not people-first) — because the semantics of an account are fundamentally different from a contact.

This brief mirrors the Contact-360 shape with **CRM-expert-informed differences** that account for the fact that accounts are post-conversion *workspace containers* (multiple projects + contacts + leads), not stakeholder records.

---

## What the CRM domain expert pushed back on

Before locking scope, an industry-best-practice review by the `/crm-expert` skill ran a fresh consultation. Key findings:

> **The Account is a workspace container, not a stakeholder record.** PSA pattern (Productive, Teamwork, Harvest) — not Salesforce-Contact pattern.

1. **Right column is work-status-first, not people-first.** Don't put a Primary Contact card at the top. Primary Contact is an identity attribute (like "CEO of") — promote it to the LEFT header. Right column gets: Health Snapshot → Account Team (v2) → Open Leads.
2. **Middle column = tabs YES, stacked sections NO.** Accounts have higher child volume than contacts; stacked sections break single-column reading.
3. **Action button primary = "Add Project"** (agency CRMs lead with new project creation), not "Email Primary".
4. **Drop the Lead Provenance card.** Lead-to-account doesn't have the clean 1:1 mapping lead-to-contact does. Open Leads card already covers any pre-conversion attachment.
5. **EXCLUDE from v1** (same trap as Contact 360):
   - No **Stage / Pipeline / Convert** — accounts are post-conversion.
   - No **Score** — even less meaningful than for contacts.
   - **No account-level Tasks** — would compete with project-level Tasks. Critical. If users want account-level reminders, that's "Account Notes" with @-mentions in v2.
   - No **counselor-style "Assigned To"** — accounts have one `owner_id` (account manager); surface that, don't duplicate.
   - No **AI Insights** tab. No **nurture campaigns / sequences** (pre-conversion concept). No **dedup UI** (pre-conversion concept).

> **High-value account-specific surfaces deferred to v2 (call out in brief, not in v1):** billable hrs this month + lifetime billable $ are *table-stakes* for an agency CRM. Per locked decision they're v2; brief mentions them as the immediate next deliverable.

---

## Scope

### In scope (v1)

1. **3-column layout** matching `lead-detail-v2.tsx`'s grid: `grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6`.
2. **Left column**: `AccountSummaryCard` (Building2 avatar + name + Active/Inactive + Primary Contact pill + Owner pill + 4 action buttons) + `AccountKeyInfoSection` (Owner · Primary Contact · # Active Projects link · # Contacts link · # Open Leads · Created · Last updated).
3. **Middle column**: `AccountTabs` with 5 tab triggers. **3 wired in v1** (Overview · Projects · Contacts); 2 disabled with "Coming soon" hover hint (Activity · Billing).
4. **Right column**: `AccountRelatedPanel` orchestrating `HealthSnapshotCard` → `OpenLeadsCard` (conditional render).
5. **Three small backend additions** to `GET /api/v1/accounts/[id]` (see Backend section): `owner_email`, `project_status_mix`, `open_leads_count`.
6. **Action buttons on left card** (CRM-expert ordered): **+ Project · + Contact · ✉ Email Primary · ⋯ More**. "More" dropdown: Edit (opens AccountForm) · Toggle Active/Inactive · Delete (admin only, with confirmation).
7. **Preserve all existing functionality**: primary-contact picker (currently in header) moves to the AccountSummaryCard; Toggle Active stays (now under More); inline Edit via AccountForm replaces the implicit-Edit-via-PATCH pattern.

### Out of scope (deferred)

- **Billable hrs this month + Lifetime billable $** in KEY INFO — v2 brief once time-entries summary patterns are warm. Reuse `/api/v1/time-entries/summary?dimension=account` then.
- **Account Team card** — needs multi-table join (projects → project_contacts → contacts + tasks.assignee_id → users). No half-built aggregation exists. v2.
- **Activity tab** content — no `account_activities` table. Could derive from `events`, but defer. v2.
- **Billing tab** content — invoices + retainer + billable breakdown by project/month. v2 minimum, likely v3.
- **Last activity date** computed field — cheap (`MAX(updated_at) on projects`) but bundled into the billable-totals v2 brief for consistency.
- **At-risk health score** — needs defined signals (no activity X days, missed deadlines). Separate brief.
- **Project-status mix pie chart** — recharts visualization. Status-dot row in HealthSnapshotCard carries 80% of the value. v2 polish.
- **MRR / retainer model** — requires contract/agreement table. v3.
- **Lead Provenance card** — dropped (see CRM-expert pushback above).

---

## Layout — per column

### Left column (280px)

**`AccountSummaryCard`** — Building2 circular icon-avatar (not initials — accounts are organizations); account name (text-xl font-semibold #0f0f10); Active/Inactive badge inline (bg-green-50 text-green-700 OR bg-gray-100 text-gray-500, matches today); Primary Contact pill (clickable to `/contacts/[primary_contact_id]`, shows "Set primary contact" placeholder when null + opens existing primary-contact picker popover); Owner pill (display `owner_email`; non-clickable in v1); 4 action buttons in horizontal row:

1. **+ Project** (primary action, slightly emphasized) — opens existing `ProjectForm` with `accountId` pre-filled.
2. **+ Contact** — opens existing `ContactForm` with `accountId` pre-filled.
3. **✉ Email Primary** — `mailto:` `account.primary_contact_email`. Disabled when null.
4. **⋯ More** — `DropdownMenu`: Edit (opens AccountForm) · Toggle Active/Inactive · Delete (admin only).

**`AccountKeyInfoSection`** — "KEY INFORMATION" header (uppercase tracking-wide text-xs text-muted-foreground); key/value rows:

- **Owner** — display `owner_email`.
- **Primary Contact** — display name link or "—".
- **# Active Projects** — count from `project_status_mix` (planning+active+in_review summed); link to Projects tab.
- **# Contacts** — total contacts on account; link to Contacts tab.
- **# Open Leads** — `open_leads_count`.
- **Created** — formatted date.
- **Last updated** — formatted date.

### Middle column (flex)

**`AccountTabs`** — 5 tab triggers; 3 wired in v1.

- **Overview** (wired): 4 stacked cards
  1. **Active Projects summary card** — title + count + status-mix dot row (●●○○ etc. using STATUS_COLOR). "See all" link → Projects tab.
  2. **Recent Contacts card** — first 5 contacts, name links + title; "See all" link → Contacts tab.
  3. **Recent Leads card** — first 5 open leads (`converted_at IS NULL`), name links + status; "See all" link → leads filtered by account.
  4. **Notes card** — `whitespace-pre-wrap` blob; "[edit]" icon button opens `AccountForm` with notes auto-focused (acceptable v1 substitute for a real notes composer).
- **Projects** (wired): full project table; columns: name (link) · status (ProjectStatusBadge) · owner (when present) · rate · is_billable · created. Status filter pills mirroring `/projects` board. "+ New project" button top-right. Data source: existing `/api/v1/projects?account_id=X`.
- **Contacts** (wired): full contact table; columns: avatar (initials) · name (link) · title · email · status (ContactStatusBadge). "+ Add contact" button top-right. Data source: existing `/api/v1/accounts/[id]/contacts?include_inactive=1`.
- **Activity** (disabled): "Coming soon — account activity feed v2" on hover.
- **Billing** (disabled): "Coming soon — invoices, retainer, billable totals v2" on hover.

### Right column (320px)

**`AccountRelatedPanel`** — orchestrator. Renders top-to-bottom:

1. **`HealthSnapshotCard`** — "HEALTH" uppercase header. Rows: Active/Inactive · "Projects: N" with status-dot row (●●○○ — colored dots using STATUS_COLOR, hover shows status name) · "Open leads: N".
2. **`OpenLeadsCard`** — **only renders when `open_leads_count > 0`**. List of open leads (name link + status). Capped at first 5; "See all (N)" link when more. Data source: existing `/api/v1/accounts/[id]/leads`.

That's it for the right column in v1 — sparse by design. Account Team + Activity preview cards land in v2.

---

## Backend additions

Three small additions to **one existing endpoint**. No new routes, no migrations.

### Extend `GET /api/v1/accounts/[id]`

**File**: `src/app/(main)/api/v1/accounts/[id]/route.ts`.

Add 3 fields to the response payload via `Promise.all` parallel queries:

```ts
{
  data: {
    ...account,                                         // existing
    owner_email: string | null,                         // NEW
    project_status_mix: {                               // NEW
      planning: number,
      active: number,
      in_review: number,
      delivered: number,
      on_hold: number,
      cancelled: number,
    },
    open_leads_count: number,                           // NEW
  }
}
```

**Implementation notes for Sonnet:**

- **`owner_email`**: when `account.owner_id` is non-null, look up via `scopedClient.raw().auth.admin.getUserById(account.owner_id)`. `raw()` is the documented escape hatch from CLAUDE.md for cross-tenant `auth.users` reads. Pattern lifted from Contact 360's `account_owner_email` extension.
- **`project_status_mix`**: `SELECT status, count(*) FROM projects WHERE account_id = X AND tenant_id = auth.tenantId GROUP BY status`. Return an object keyed by all 6 statuses with 0 defaults so the UI doesn't crash on absent keys. Use `scopedClient(auth).from("projects")` — PostgREST group-by-count via `.select("status", { count: "exact" })` over a loop, OR raw RPC. Easiest: `db.from("projects").select("status").eq("account_id", id)` then reduce in app code (fine for typical project counts <100).
- **`open_leads_count`**: `db.from("leads").select("*", { count: "exact", head: true }).eq("account_id", id).is("converted_at", null).is("deleted_at", null)`. PostgREST exact count with `head: true` returns count only — no row payload. Cheap.
- All 3 queries + the existing account fetch run in parallel via `Promise.all`.
- Skip queries cleanly when prerequisites are null (e.g., `owner_email` skipped when `owner_id` is null).

### NO other backend changes

- No new endpoints. No DB migrations. No changes to PATCH or DELETE on `/api/v1/accounts/[id]`.
- The `/api/v1/projects` + `/api/v1/accounts/[id]/contacts` + `/api/v1/accounts/[id]/leads` endpoints are unchanged — the new tabs reuse them.

---

## Files to touch

| File | Change | LOC est. |
|---|---|---|
| `src/industries/it-agency/features/accounts/pages/account-detail.tsx` | **Rewrite**. Replace single-column structure with 3-column layout. Orchestrator pattern: holds state for `account`, `loading`, dialogs (`editOpen`, `deleteOpen`, `createProjectOpen`, `createContactOpen`, `primaryPickerOpen`), data (`contacts`, `projects`, `leads`), delegates rendering to subcomponents. | ~280 (down from 471) |
| `src/industries/it-agency/features/accounts/components/account-detail/account-summary-card.tsx` | **New**. Building2 avatar + name + Active/Inactive + Primary Contact pill + Owner pill + 4 action buttons. | ~180 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-key-info-section.tsx` | **New**. KEY INFORMATION section: 7 rows. | ~80 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-tabs.tsx` | **New**. Tabs orchestrator: 5 triggers, 3 wired panels. Disabled triggers render no panel — just tooltip on hover. | ~80 |
| `src/industries/it-agency/features/accounts/components/account-detail/overview-tab.tsx` | **New**. 4 stacked cards: Active Projects summary · Recent Contacts · Recent Leads · Notes. | ~200 |
| `src/industries/it-agency/features/accounts/components/account-detail/projects-tab.tsx` | **New**. Full project table; columns + status filter + "+ New project" button. Uses existing `ProjectForm`. | ~180 |
| `src/industries/it-agency/features/accounts/components/account-detail/contacts-tab.tsx` | **New**. Full contact table; columns + "+ Add contact" button. Uses existing `ContactForm`. | ~150 |
| `src/industries/it-agency/features/accounts/components/account-detail/account-related-panel.tsx` | **New**. Right column orchestrator: HealthSnapshotCard + OpenLeadsCard (conditional). | ~50 |
| `src/industries/it-agency/features/accounts/components/account-detail/health-snapshot-card.tsx` | **New**. HEALTH header + Active/Inactive + Projects count + status-dot row + Open leads count. Uses `STATUS_COLOR` from `project-board/components/project-column.tsx`. | ~80 |
| `src/industries/it-agency/features/accounts/components/account-detail/open-leads-card.tsx` | **New**. List of open leads capped at 5; "See all" link. Returns null when count === 0. | ~60 |
| `src/industries/it-agency/features/accounts/components/account-detail/index.ts` | **New**. Barrel export. | ~10 |
| `src/app/(main)/api/v1/accounts/[id]/route.ts` | **Extend GET**. Add 3 parallel queries. PATCH + DELETE untouched. | ~40 new lines |

**Total: 12 files (10 new + 1 rewrite + 1 extend). ~1,070 LOC net.** New composition; existing `account-detail.tsx` shrinks ~40% as logic moves to subcomponents.

---

## Patterns to reuse (from existing code)

- **3-column layout**: `src/components/dashboard/lead/lead-detail-v2.tsx:195-319`. Same grid template + column widths + gap. Don't reinvent.
- **Left column structure**: `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-summary-card.tsx`. Mirror the visual structure; swap contact-specific bits (avatar initials, status badge) for account-specific (Building2 icon, Active/Inactive pill).
- **Key info section**: `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-key-info-section.tsx`. Same uppercase-header pattern + key/value rows.
- **Tab strip with disabled triggers**: `src/industries/it-agency/features/crm-contacts/components/contact-detail/contact-tabs.tsx`. Use shadcn's `disabled` prop on TabsTrigger + `<Tooltip>` wrapping for the hover hint.
- **`ProjectStatusBadge`**: `src/industries/it-agency/features/time-tracking/components/status-badge.tsx`. Already in use in current `account-detail.tsx:23`.
- **`STATUS_COLOR` map**: `src/industries/it-agency/features/project-board/components/project-column.tsx:31-38`. Import for the status-dot row hex values.
- **`ContactStatusBadge`**: `src/industries/it-agency/features/crm-contacts/components/contact-status-badge.tsx`.
- **`AccountForm` (create/edit)**: `src/industries/it-agency/features/accounts/components/account-form.tsx`. Reuse as-is for Edit dropdown + Notes inline edit.
- **`ProjectForm`**: `src/industries/it-agency/features/accounts/components/project-form.tsx`. Pre-fills `accountId`.
- **`ContactForm`**: `src/industries/it-agency/features/crm-contacts/components/contact-form.tsx`. Pre-fills `accountId`.
- **Primary contact picker popover**: lives in current `account-detail.tsx:193-256`. Extract into `AccountSummaryCard`.
- **`scopedClient.raw()` escape hatch**: `src/lib/supabase/scoped.ts`. Use for `owner_email` lookup against `auth.users`. Same pattern as Contact 360's `account_owner_email`.
- **Design tokens** (from established design pass): primary text `#0f0f10`, secondary `#787871`, dropdown hover overlay `#0000170b`, status pills bg-green-50/700 + bg-gray-100/500, card chrome `border border-border bg-card rounded-lg`, buttons `rounded-lg`.

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (CI hard gate).
- [ ] `/accounts/[id]` opens with the new 3-column layout.
- [ ] **Left column**:
  - Building2 avatar shows; account name + Active/Inactive pill render inline.
  - Primary Contact pill: shows name when set (link to `/contacts/[id]`); shows "Set primary contact" placeholder when null (clicking opens existing picker popover); clearable.
  - Owner pill: shows `owner_email`; no-op on click (read-only in v1).
  - 4 action buttons render: + Project (primary), + Contact, ✉ Email Primary (disabled when no primary_contact_email), ⋯ More.
  - More dropdown: Edit (opens AccountForm); Toggle Active (flips is_active); Delete (admin only, with confirmation).
  - KEY INFORMATION section: 7 rows render correctly; # Active Projects + # Contacts are clickable and jump to the corresponding tab.
- [ ] **Middle column**:
  - 5 tab triggers render; Overview/Projects/Contacts wired; Activity/Billing visibly disabled with "Coming soon" tooltip on hover.
  - **Overview tab**: Active Projects summary card with status-dot row · Recent Contacts (max 5) · Recent Leads (max 5) · Notes blob with "[edit]" button.
  - **Projects tab**: full project table; "+ New project" opens ProjectForm pre-filled; status filter pills work; row click → `/time-tracking/projects/[id]`.
  - **Contacts tab**: full contact table; "+ Add contact" opens ContactForm pre-filled; row click → `/contacts/[id]`.
- [ ] **Right column** (in order):
  - **HealthSnapshotCard**: Active/Inactive · "Projects: N" with colored status dots · "Open leads: N".
  - **OpenLeadsCard**: renders only when `open_leads_count > 0`; lists first 5 leads with name + status; "See all" link when >5; **renders nothing when 0** (don't show an empty card).
- [ ] **Backend**: `GET /api/v1/accounts/[id]` response includes `owner_email`, `project_status_mix` (6 keys with 0 defaults), `open_leads_count` (integer ≥0). Verify with DevTools.
- [ ] **AccountForm** create / edit / delete flows preserved end-to-end.
- [ ] **Page-padding fix**: drop `p-6` + `max-w-4xl` from the page wrapper (`account-detail.tsx:161`). Shell already provides `p-4`.
- [ ] **Non-IT-agency tenants**: `/accounts/[id]` 404s (industry gate already in place via `getFeatureAccess(industry, FEATURES.ACCOUNTS)` on the page route).
- [ ] **Counselor role**: edit / delete / toggle / +new buttons stay admin-gated.
- [ ] **All 7 code-review checklist items** considered (see PostgREST FK + page-padding callouts in the brief metadata).

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing an Account detail page redesign on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/ACCOUNT-DETAIL-360-BRIEF.md end-to-end before touching any code — it has the full scope (with explicit out-of-scope items), the file list, the exact patterns to mirror from Contact 360 + Lead detail v2, the small backend additions, and the verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b feat/account-detail-360 origin/stage
2. Implement the 12 file changes per the brief:
   - 1 rewrite: account-detail.tsx (the page orchestrator, shrinks ~40% as logic moves into subcomponents)
   - 10 new subcomponents under src/industries/it-agency/features/accounts/components/account-detail/ (summary-card, key-info-section, tabs, overview-tab, projects-tab, contacts-tab, related-panel, health-snapshot-card, open-leads-card, index)
   - 1 extend: src/app/(main)/api/v1/accounts/[id]/route.ts — add owner_email + project_status_mix + open_leads_count to GET via Promise.all parallel queries
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — this is the CI hard gate, local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief, especially the page-padding check (drop existing p-6 + max-w-4xl on the wrapper — the dashboard shell at src/components/dashboard/shell.tsx:409 already provides p-4).
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief (and the CRM-expert review baked into it):
- This is a UI restructure + 3 small backend additions. NO database migrations. NO new API routes. Reuse existing /api/v1/projects?account_id=X, /api/v1/accounts/[id]/contacts, /api/v1/accounts/[id]/leads — they already do what the new tabs need.
- Middle column has 5 tab triggers but only 3 panels (Overview, Projects, Contacts). Activity + Billing triggers are DISABLED with "Coming soon" hover hints. Don't render empty/fake panels for them.
- Right column is sparse by design: HealthSnapshotCard + OpenLeadsCard (conditional). No Lead Provenance card. No Account Team card (deferred to v2).
- Primary Contact is in the LEFT column header (identity attribute), NOT the right column.
- Do NOT add: Stage, Pipeline, Convert, Score, account-level Tasks, AI Insights, nurture sequences, dedup UI, Lead Provenance, Account Team. All explicitly excluded by the brief.
- Do NOT add billable_hrs_this_month, lifetime_billable_amount, account_team, last_activity_at to the GET response — those are explicitly deferred to a v2 brief.
- Do NOT reuse or move src/components/dashboard/lead/ files — those stay lead-shaped. Build account-shaped equivalents in the new components/account-detail/ directory.
- DO drop the page wrapper's p-6 + max-w-4xl in the rewrite — dashboard-shell padding fix from f9af70d on /projects + the Contact 360 brief.
- DO preserve all existing functionality: AccountForm create/edit, ProjectForm, ContactForm, primary-contact picker popover, Toggle Active, Delete confirmation. They relocate into the new structure.
- DO use design tokens: #0f0f10 primary text, #787871 secondary, #0000170b dropdown hover overlay, rounded-lg buttons.

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing. Especially: if `project_status_mix` GROUP BY via PostgREST is awkward to express, fall back to fetching `status` rows + reducing in app code (project counts per account are typically <100, no perf concern).
```

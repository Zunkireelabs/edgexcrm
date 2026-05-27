# CRM Contacts (it_agency) — In-flight Brief

> Companion to the Opus planning session that produced this brief. Sonnet (executor) reads this file end-to-end before writing any code. Opus reviews Sonnet's output between phases.

**Started**: 2026-05-26
**Lead architect**: Sadin
**Planner (this doc)**: Opus
**Executor**: a separate Sonnet session
**Status**: Planned / ready for Phase A

---

## Context

The it_agency CRM models the company-side hierarchy: **Account → Project → Task → TimeEntry** (Accounts promotion shipped on `stage` at `3f83642`). What's missing is the **people-side**: the actual humans at those accounts the team talks to, sends invoices to, runs projects with.

Today every person-shaped record is a `lead` — but Leads are top-of-funnel prospects, not the steady-state customer contacts you'd communicate with for years. The mismatch shows up everywhere: there's no clean way to say "John at Salesforce is the primary contact on the website project; Siera at Salesforce is the primary contact on the software project," even though both projects already exist.

**The fix**: introduce a `Contact` entity (person at a customer Account) with a `Lead → Contact` conversion flow, plus a junction table linking contacts to projects with optional roles. Standard Salesforce/Zoho B2B pattern.

Once shipped, this is the missing piece between Anish's CRM-side workflows (lead → close) and the agency-billing side (account → project → billable time entry). It also clears the runway for Phase 5 (rates + billable totals) to land in a coherent product surface where invoices have a real "bill-to contact."

**Note on naming**: the existing education_consultancy `/contacts` feature is a misnomer — it's a filtered view of `leads WHERE lead_type='prospect'`, NOT an entity. The new it_agency Contacts is a real entity. They share the English word; this brief handles the route collision via industry dispatch on the existing `/contacts/page.tsx` shell.

---

## Scope decisions (locked in by Sadin during planning)

| # | Decision | Choice | Reason |
|---|---|---|---|
| A | Project ↔ Contact relationship | **Junction table** `project_contacts(project_id, contact_id, role)`. Projects stay owned by Account. | Survives contact churn; supports multi-stakeholder projects (billing CFO + technical lead); billing-by-account is one join. |
| B | Lead → Contact conversion semantics | **Freeze the Lead**: `leads.converted_at TIMESTAMPTZ NULL` + `leads.converted_contact_id UUID NULL`. All default leads queries get `WHERE converted_at IS NULL`. | Preserves source/utm/velocity reporting. Salesforce pattern. |
| C | Contact ↔ Account cardinality | **Required, 1:N.** `contacts.account_id NOT NULL`. Convert UI forces account selection. | Matches Sadin's mental model (every Contact is at a company); keeps billing clean. |
| D | Feature ID | New `FEATURES.CRM_CONTACTS = "crm-contacts"` in `src/industries/_registry.ts`. Separate from `FEATURES.CONTACTS` (education). | Distinct features, distinct compile-time IDs. |
| E | URL + dispatch | Both industries' "contacts" live at `/contacts`. The existing shell at `src/app/(main)/(dashboard)/contacts/page.tsx` becomes industry-aware: dispatches to either the education prospects view (existing) or the new it_agency CRM-contacts view based on tenant industry. | Universal CRM URL convention; ~10 lines of dispatch logic in the shell. |
| F | Sidebar | New it_agency manifest entry: Contacts (icon: `Contact` or `UsersRound`). **Positioned ABOVE Accounts** (sequence: Universal Leads → Contacts → Accounts → Time Tracking). | Matches Salesforce/HubSpot — daily CRM work happens on people more than companies. |
| G | `accounts.primary_contact_email` | Don't migrate the data; just add `primary_contact_id UUID NULL REFERENCES contacts(id)` alongside. UI can pick from contacts. Email column stays for backfill compatibility. | Avoid a destructive data migration; clean cutover later. |

---

## Data model

### `contacts` table (new)

```sql
CREATE TABLE contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  title               TEXT,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  assigned_to         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes               TEXT,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trigger_contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE INDEX idx_contacts_tenant_account ON contacts(tenant_id, account_id);
CREATE INDEX idx_contacts_tenant_email ON contacts(tenant_id, email) WHERE deleted_at IS NULL;
```

App-level validation: at least one of `email` or `phone` is required (returned as 400 from the API).

### `project_contacts` table (new — junction)

```sql
CREATE TABLE project_contacts (
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role         TEXT CHECK (role IN ('primary','technical','billing','other')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contact_id)
);
CREATE UNIQUE INDEX project_contacts_one_primary ON project_contacts(project_id) WHERE role = 'primary';
CREATE INDEX idx_project_contacts_contact ON project_contacts(contact_id);
```

The partial unique index enforces "at most one primary contact per project" at the DB level.

### `leads` ALTER (conversion plumbing)

```sql
ALTER TABLE leads
  ADD COLUMN converted_at         TIMESTAMPTZ,
  ADD COLUMN converted_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_converted ON leads(tenant_id) WHERE converted_at IS NOT NULL;
```

### `accounts` ALTER (primary contact link)

```sql
ALTER TABLE accounts
  ADD COLUMN primary_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
```

Note: `accounts.primary_contact_email` (text) stays for backfill compatibility. No data migration; UI just stops writing to it.

### RLS

Standard tenant-isolation pattern from migration 020:
- `contacts`: tenant_id-based SELECT/INSERT/UPDATE/DELETE via `get_user_tenant_ids()` / `is_tenant_admin()` SECURITY DEFINER helpers.
- `project_contacts`: SELECT/INSERT/DELETE allowed when the user has access to BOTH the project's tenant AND the contact's tenant (which will always be the same tenant — sanity check).

---

## API surface

All routes follow the standard pattern: `authenticateRequest` → `getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS) → apiForbidden` → `scopedClient(auth)` → `validate` → audit log + event emission.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/v1/contacts` | List contacts in tenant. Filters: `account_id`, `status`, `q` (search name/email/title). |
| POST | `/api/v1/contacts` | Create contact. Body: first_name, last_name, account_id (required), optional email/phone/title/notes. |
| GET | `/api/v1/contacts/[id]` | Single contact + joins on `accounts(id,name)` + `project_contacts(role, projects(id,name))`. |
| PATCH | `/api/v1/contacts/[id]` | Update contact fields. |
| DELETE | `/api/v1/contacts/[id]` | Soft delete (set `deleted_at`). Also clears `accounts.primary_contact_id` if it pointed here. |
| GET | `/api/v1/accounts/[id]/contacts` | Contacts at an account, ordered by name. `?include_inactive=1` to include. |
| POST | `/api/v1/contacts/[id]/projects` | Link contact to a project with optional role. Body: `{ project_id, role? }`. |
| PATCH | `/api/v1/contacts/[id]/projects` | Change role. Body: `{ project_id, role }`. |
| DELETE | `/api/v1/contacts/[id]/projects?project_id=X` | Unlink. |
| POST | `/api/v1/projects/[id]/contacts` | Symmetric direction for project-detail UI. Same body shape. |
| POST | `/api/v1/leads/[id]/convert` | Atomic Lead → Contact conversion. Body: `{ account_id?, new_account?: { name, ... } }`. Returns `{ contact, account, lead }`. See Phase D for the TOCTOU-safe pattern. |

---

## UI surface

| Route | Component | Purpose |
|---|---|---|
| `/contacts` | `ContactsListPage` (it_agency) / `ProspectsView` (education — unchanged) | Industry-dispatched. it_agency: table/list of all contacts in tenant with search + filters + Add Contact dialog. |
| `/contacts/[id]` | `ContactDetailPage` | Header (name/title/status), info card (email/phone/account link), Projects-involved section with role pills, Notes, Edit/Delete actions for admin. |
| `/accounts/[id]` | Extension to existing `AccountDetailPage` | Add an inline Contacts section above or below Projects. "Add Contact" button (pre-fills `account_id`). "Primary contact: [name]" pill at the top. |
| `/time-tracking/projects/[id]` | Extension to existing `ProjectDetailPage` | Add a Contacts section with role pills + add/remove/change-role for admin. |
| `/leads/[id]` | Extension to existing `LeadDetailV2` | Add "Convert to Contact" button (visible when `converted_at IS NULL`, at ANY stage). Opens `ConvertLeadDialog`. |

---

## Industry scoping wiring (mandatory steps)

1. `src/industries/_registry.ts`: add `CRM_CONTACTS: "crm-contacts"` under the it_agency section.
2. `src/industries/it-agency/features/crm-contacts/meta.ts` (new file): `{ id: FEATURES.CRM_CONTACTS, industries: [INDUSTRIES.IT_AGENCY] }`.
3. `src/industries/it-agency/manifest.ts`: register `crmContactsMeta`, add sidebar entry `{ featureId: FEATURES.CRM_CONTACTS, href: "/contacts", label: "Contacts", icon: "Contact" }` (or `"UsersRound"`), positioned ABOVE the Accounts entry.
4. `src/components/dashboard/shell.tsx`: register the icon in `INDUSTRY_ICONS` + lucide import.
5. `src/app/(main)/(dashboard)/contacts/page.tsx`: refactor to industry-dispatch (see Phase A spec).
6. Every API route: `getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)` → 403 for non-it_agency tenants.

---

## Phasing — 5 Sonnet phases, Opus reviews between each

Same Opus-plans / Sonnet-executes split that shipped Time Tracking + Accounts. Sonnet branches per phase, pushes branch only, Opus merges to stage after smoke. **Local-verify-before-push** is the rule.

### Phase A — Schema + manifest scaffolding (~0.5 day)

- Migration `supabase/migrations/021_contacts.sql` per the Data Model section.
- Type system additions in `src/types/database.ts` (new `Contact`, `ProjectContact`, `ContactStatus`, `ProjectContactRole`; extend `Lead` + `Account`).
- Industry wiring per the section above (steps 1–5).
- Placeholder components in `src/industries/it-agency/features/crm-contacts/pages/{contacts-list,contact-detail}.tsx` rendering "Coming soon — Phase B".
- Route shell refactor: `/contacts/page.tsx` becomes industry-aware:
  - `education_consultancy` + `getFeatureAccess(industry, FEATURES.CONTACTS)` → existing ProspectsView (unchanged).
  - `it_agency` + `getFeatureAccess(industry, FEATURES.CRM_CONTACTS)` → new placeholder `ContactsListPage`.
  - else → `notFound()`.
- Verification: as Zunkireelabs, Contacts sidebar item shows above Accounts, `/contacts` renders placeholder. As Admizz, sidebar unchanged, `/contacts` renders existing ProspectsView (NO regression).

### Phase B — Contacts CRUD + list + detail (~1.5 days)

- 5 API routes: list+create, get+patch+delete, by-account, contact↔project link helpers.
- `ContactsListPage` real implementation (mirror `accounts-list.tsx` patterns).
- `ContactDetailPage` real implementation (header + info + Projects placeholder for Phase C + Notes).
- `ContactForm` dialog component.
- `ContactStatusBadge` component.
- Extend `account-detail.tsx`: inline Contacts section with Add button + "Primary contact" pill picker (admin only).
- Verification: full CRUD as Zunkireelabs admin; 403 as Admizz; soft-delete clears `accounts.primary_contact_id` if matched.

### Phase C — Project ↔ Contact linkage (~0.5 day)

- `/api/v1/contacts/[id]/projects` + `/api/v1/projects/[id]/contacts` routes.
- Wire "Projects involved" section on `contact-detail.tsx`.
- Add Contacts section to `project-detail.tsx` (the page that stayed in time-tracking after Accounts promotion).
- `ProjectContactPicker` shared component (scoped to project's account_id by default; option to widen).
- Verification: John → Salesforce → Website (primary). Siera → Salesforce → Software (primary). Both projects show correct primary; both contacts show correct project list.

### Phase D — Lead → Contact conversion (~1 day)

- `/api/v1/leads/[id]/convert` route. Critical pattern:
  1. Authenticate + admin OR owner-of-lead.
  2. Fetch lead via `scopedClient(auth)`. Quick precondition: 409 if already converted.
  3. Resolve account (existing or new). 400 if neither.
  4. Insert contact (with `assigned_to = leads.assigned_to ?? auth.userId`).
  5. **Atomic conversion update** — TOCTOU-safe, same pattern as Phase 4 approve/reject: `UPDATE leads SET converted_at=NOW(), converted_contact_id=<new>, account_id=COALESCE(account_id, <resolved>) WHERE id=$1 AND converted_at IS NULL`. Use `.maybeSingle()`. **If 0 rows → race lost, DELETE the orphan contact, return 409.** Critical: do NOT skip this.
  6. Audit log + emit `lead.converted` event.
  7. Return `{ contact, account, lead }`.
- `ConvertLeadDialog` on `lead-detail-v2.tsx`:
  - Visible whenever `converted_at IS NULL` (any stage — NOT gated to Won).
  - Account picker: radio "Use existing" (combobox) OR "Create new" (inline name).
  - **If `leads.account_id` is already set → default to "Use existing: <name>" pre-selected.**
  - Pre-populates contact fields from lead.
  - On submit → call convert API → navigate to new contact's detail page.
- Filter all default leads queries: add `WHERE converted_at IS NULL` to `/api/v1/leads` GET, `/api/v1/accounts/[id]/leads` GET, `useLeads`, `leads-table.tsx`, `leads-board.tsx`, dashboard widgets.
- Optional `?include_converted=1` flag for future "All Leads (incl. converted)" view.
- Verification:
  - Convert from any stage works.
  - Lead with `account_id` set → dialog pre-selects.
  - Try to convert again → 409.
  - **TOCTOU two-window test**: open dialog in two browser windows for same lead → submit both → exactly one succeeds, exactly one contact created.
  - As Admizz: convert → 403.

### Phase E — Polish + docs + smoke (~0.5 day)

- Counselor scoping already locked in Phase A schema (`contacts.assigned_to` mirrors `leads.assigned_to`). Phase E verifies end-to-end.
- `docs/FEATURE-CATALOG.md`: new CRM_CONTACTS row; update Accounts row; update Leads row.
- `docs/SESSION-LOG.md` + `docs/STATUS-BOARD.md`: shipping entry.
- Full smoke as both Zunkireelabs (positive paths) and Admizz (negative — 404/403, zero regression on their existing /contacts).

**Total v1 estimate: ~4 working days of Sonnet execution + Opus review cycles between phases.**

---

## Critical files (cumulative across all 5 phases)

**New:**
- `supabase/migrations/021_contacts.sql`
- `src/industries/it-agency/features/crm-contacts/meta.ts`
- `src/industries/it-agency/features/crm-contacts/pages/{contacts-list,contact-detail}.tsx`
- `src/industries/it-agency/features/crm-contacts/components/{contact-form,contact-status-badge,project-contact-picker,convert-lead-dialog}.tsx`
- 5 API route files under `src/app/(main)/api/v1/contacts/`
- `src/app/(main)/api/v1/accounts/[id]/contacts/route.ts`
- `src/app/(main)/api/v1/projects/[id]/contacts/route.ts`
- `src/app/(main)/api/v1/leads/[id]/convert/route.ts`

**Modified:**
- `src/industries/_registry.ts`
- `src/industries/it-agency/manifest.ts`
- `src/components/dashboard/shell.tsx` (icon registration only — one line + import)
- `src/types/database.ts`
- `src/app/(main)/(dashboard)/contacts/page.tsx` (industry dispatch — biggest cross-feature touch)
- `src/industries/it-agency/features/accounts/pages/account-detail.tsx`
- `src/industries/it-agency/features/time-tracking/pages/project-detail.tsx`
- `src/components/dashboard/lead/lead-detail-v2.tsx`
- Leads-fetching surfaces: `/api/v1/leads/route.ts`, `/api/v1/accounts/[id]/leads/route.ts`, `useLeads` hook, `leads-table.tsx`, `leads-board.tsx`, dashboard widgets
- `docs/FEATURE-CATALOG.md`, `docs/SESSION-LOG.md`, `docs/STATUS-BOARD.md`

**Reuse (don't reinvent):**
- `scopedClient(auth)` from `src/lib/supabase/scoped.ts`.
- `getFeatureAccess`, `getCurrentUserTenant` patterns — copy from `/accounts/page.tsx`.
- `validate` + `apiSuccess/apiPaginated/apiError/apiForbidden` helpers.
- `AccountForm` / `ProjectForm` dialog patterns for `ContactForm`.
- `update_updated_at()` DB function.

---

## Verification (Opus runs at each phase boundary)

1. `npm run build` clean.
2. `npm run lint` — 0 errors, only pre-existing warnings.
3. Migration applied to staging DB; tables exist; RLS enabled.
4. As Zunkireelabs admin: every new page renders, CRUD works (or placeholder shows for current phase), conversion works (Phase D+).
5. As Admizz: no CRM Contacts in sidebar, `/contacts` renders existing ProspectsView (zero regression), `/api/v1/contacts` returns 403.
6. Tenant isolation: two Zunkireelabs users see same data; Admizz can never see Zunkireelabs contacts.
7. `getFeatureAccess(IT_AGENCY, CRM_CONTACTS) === true`, `(EDUCATION_CONSULTANCY, CRM_CONTACTS) === false`.
8. **(Phase D)** TOCTOU two-window test: parallel converts → exactly one wins, one orphan deleted, 409 returned to loser.

---

## Out of scope (explicit non-goals for v1)

- Contact activity log (calls/emails/meetings — separate feature).
- Per-contact notes thread with timeline. Single `notes` field is enough.
- HubSpot-style N:M contact↔account.
- CSV contact import.
- Email / calendar integration / threading.
- Deduplication on contact creation (duplicates allowed; warn-don't-block can come later).
- Bulk operations (bulk convert, bulk role change, etc.).
- Multi-pipeline conversion edge cases (convert from current pipeline only).
- Contact-level permissions (tenant + role-level only for v1).

---

## After this ships

- **Phase 5 of Time Tracking** (rates + billable totals) lands next, completing Time Tracking v1.
- **Promote `stage` → `main`** to push Time Tracking v1 + Accounts + Contacts to production in one coherent release.
- **Future v2**: contact activity log; deduplication; HubSpot-N:M opt-in; project-contact role-based permissions.

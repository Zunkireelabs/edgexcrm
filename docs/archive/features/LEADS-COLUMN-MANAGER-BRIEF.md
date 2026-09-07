# Leads Column Manager — Build Brief ("Edit columns")

> Planner: Opus. Executor: a separate Sonnet session (reads this end-to-end before any code).
> Opus reviews + gates each phase before push to stage. **Status: design approved 2026-06-09; awaiting Sonnet pickup.**

## Goal

Add a HubSpot-style **"Columns"** control to the leads data table: a toolbar button that opens a
"Choose which columns you see" dialog where the user picks **which lead fields show as columns**,
**reorders them** (drag), and toggles visibility. **Universal — every industry/tenant.**

## Decisions locked (do NOT re-litigate)

| Decision | Choice |
|---|---|
| Persistence | **localStorage v1** — per `tenant + user`, no backend. (Pattern: `PipelineSelector.tsx` localStorage.) |
| Custom fields as columns | **Yes, discovered from the loaded leads' `custom_fields` keys** (not form_configs in v1). |
| Frozen / pinned columns | **Deferred to phase 2** — not in this build. |
| Scope | **The leads data table only** (`src/components/dashboard/leads-table.tsx`). |
| Export | **Follows the visible columns** (export what you see). |
| Anchors | `☐ select`, **Name**, **Actions** are fixed (non-removable, non-reorderable). Everything else is manageable. |

## Current state (read before touching)

- Table: `src/components/dashboard/leads-table.tsx` (~1,208 lines). Used by `/leads` and reused by the
  education **Contacts** view (`src/industries/education-consultancy/features/contacts/ui.tsx`) — Contacts is
  **out of scope** but will inherit the component; verify it still renders (it can keep defaults).
- Columns are **hardcoded** `<th>`/`<td>` (thead ~line 819, no column-config array). Current order:
  `☐ · avatar · Name · (Tag · Type if showTags) · Email · Location · Assigned · Status · Source · Last activity · Actions`.
  Several auto-hide at `md`/`lg`.
- Toolbar (~line 528): `[search + filter chips] … <spacer> [Sort] [Export] [Add Lead]`. New **Columns** button
  goes between **Sort** and **Export**.
- **No column persistence exists.** localStorage precedent: `PipelineSelector.tsx` (`pipeline_selected_${tenantId}`).
- `@dnd-kit` is already a dependency (used by pipeline + project board) — use it for reorder.
- `industryId` is available in the component (it already drives `prospectIndustryFilter`).

## Architecture

### 1. Column registry — `src/components/dashboard/leads/columns-registry.tsx` (NEW)

Single source of truth. Each column:
```ts
type LeadColumnCtx = { memberMap: Map<string,string>; industryId: string; /* helpers */ };
type LeadColumn = {
  key: string;                 // "email" | "prospect_industry" | "cf:membership_no"
  label: string;
  group: "standard" | "industry" | "custom";
  industries?: string[];       // gate; omit = all industries
  required?: boolean;          // name, actions
  defaultVisible?: boolean;
  minWidth?: string;
  align?: "left" | "right";
  render: (lead: Lead, ctx: LeadColumnCtx) => React.ReactNode;  // extract from today's <td>
};
```
- `getLeadColumns(industryId, customFieldKeys)` returns the catalog: static columns (filtered by `industries`)
  + one `cf:<key>` column per discovered custom-field key (label = humanized key, render = `String(custom_fields[key] ?? "")`).
- Keep render fns **byte-equivalent to the current cells** (status badge, avatar+name link, assigned→member name,
  source, dates via the existing formatters). Move logic, don't rewrite it.

**Catalog:**
- **Standard (all):** name*(req, anchor), email, phone, location (city+country), status, source (intake_source),
  medium (intake_medium), campaign (intake_campaign), assigned (assigned_to→member), tags, type (lead_type),
  created (created_at), last_activity (last_activity_at), preferred_contact, display_id, ai_score, ai_priority,
  actions*(req, anchor, always last).
- **it_agency only** (`industries:["it_agency"]`): company (company_name), designation, prospect_industry
  (via `prospectIndustryLabel`), salutation, company_email, owner (owner_id→member).
- **custom** (`group:"custom"`): `cf:<key>` for each key present across loaded leads.
- **Default visible** = today's set: Name, Email, Location, Assigned, Status, Source, Last activity, Actions
  (+ Tags/Type when the existing `showTags` is on). Everything else available-but-off.

### 2. Persistence — `src/lib/leads/column-prefs.ts` (NEW)
- Key: `leads_columns_${tenantId}_${userId}`. Value: `{ v: 1, columns: string[] }` (ordered visible keys,
  excluding the implicit anchors). Absent → defaults.
- On load **validate** against the live registry: drop unknown keys (e.g. a custom field that no longer exists,
  or an it_agency column on a non-it_agency tenant). Wrap all access in try/catch (localStorage may throw).

### 3. Dialog — `src/components/dashboard/leads/column-manager-dialog.tsx` (NEW)
- Matches the reference: **left** = searchable checklist grouped Standard / Industry / Custom (checkbox toggles
  membership); **right** = "SELECTED COLUMNS (n)" draggable ordered list (`@dnd-kit`, drag handle `⋮⋮`, ✕ to remove;
  anchors show 🔒 and aren't draggable/removable). Footer: **Reset to default · Cancel · Apply**.
- Apply → persist + update table state. Cancel → discard. Reset → defaults.

### 4. Table refactor — `leads-table.tsx` (EDIT)
- Add `visibleColumns` state (from prefs, fallback defaults) + `columnDialogOpen` state.
- Replace hardcoded `<thead>`/`<tbody>` cells with a map over the resolved ordered columns (anchors injected:
  select + name first, actions last). Drop the responsive auto-hide; allow horizontal scroll so the user's
  choice wins.
- Add the **Columns** toolbar button (between Sort and Export) opening the dialog.
- `exportCSV` emits the visible columns.

## Phasing (gate each before push)

- **Phase 1 — registry + refactor, NO behavior change.** Build the registry, render the table from a config that
  defaults to *today's exact columns*. Goal: visually identical `/leads`, all behavior intact. This de-risks the
  refactor of a central component; review proves equivalence.
- **Phase 2 — the feature.** `column-prefs.ts` + dialog + toolbar button + industry gating + custom-field
  discovery + export-follows-columns.

## Acceptance / non-regression checklist
- [ ] `/leads` renders identically after Phase 1 (default columns, order, formatting).
- [ ] Counselor scoping, all filters (status/source/industry/counselor/time/tag/form), Sort popover, bulk-select,
      row-click → lead detail, and Add Lead all still work.
- [ ] Columns dialog: search, add/remove, drag-reorder, Apply/Cancel/Reset.
- [ ] Choice persists across reload (same browser); distinct per tenant + user.
- [ ] it_agency tenant sees Company/Designation/Prospect Industry/etc.; education tenant does **not**.
- [ ] Custom-field keys from the tenant's data appear under "Custom fields" and render values.
- [ ] Anchors (select, Name, Actions) can't be removed/reordered.
- [ ] Export reflects visible columns. Contacts view still renders.
- [ ] `npm run build` clean; `npx eslint --max-warnings 50 .` 0 errors.

## Gotchas
- Central, highest-traffic screen — review the diff carefully; preserve every existing handler.
- Registry render fns are React nodes (client component) — fine; but the **column catalog metadata** must stay
  serializable if ever passed across the server/client boundary (keep it client-side).
- localStorage can throw (private mode) — guard.
- Humanize custom-field keys for labels (`membership_no` → "Membership No") but key off the raw key.

## Out of scope (v2)
Frozen/pinned columns · DB-backed cross-device sync · sortable column headers (click-to-sort) · custom fields
sourced from `form_configs` · the Contacts table as a first-class configurable surface · per-column width drag.

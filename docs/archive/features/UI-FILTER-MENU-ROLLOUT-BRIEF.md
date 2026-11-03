# BRIEF A — Roll out FilterMenu + flat toolbar to it_agency data tables (Accounts, Contacts, Services, Deals)

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (same branch as the leads-table FilterMenu work — do NOT branch again)
**Type:** UI-only. No API, no DB, no migrations, no new dependencies.
**Reviewer:** Opus reviews your report + re-runs gates. **Stop at the review gate — no PR, no merge, no deploy.**
**Depends on:** the already-committed `FilterMenu`/`FilterChips`/`FilterDef` in `src/components/ui/filter-menu.tsx` and the migrated `src/components/dashboard/leads-table.tsx` — **use leads-table as your worked example for every table below.**

---

## 0. Goal

Bring four it_agency data tables to match the new leads-table toolbar:
1. Replace their inline `<FilterDropdown>` pills with a single **`<FilterMenu>`** button + **`<FilterChips>`** row (config-driven, per-table `FilterDef[]`).
2. **Flatten the toolbar** to match leads: remove the `border`/`rounded-lg` box and tighten the toolbar→table gap.

This is a **presentation refactor** — reuse each table's existing filter state, option arrays, onChange handlers, `clearFilters`, `activeFiltersCount`, and (where present) `setCurrentPage(1)` exactly. Do not change filtering logic, sorting, export, RBAC gates, or data fetching.

**Out of scope (do NOT touch):** Pipeline Board, Project Board header (those are Brief B), leads-table (done), Proposals list (no toolbar), any API/DB. No new npm packages.

---

## 1. The pattern to copy (from leads-table.tsx)

For each table:
- Build a `const filterDefs: FilterDef[] = [ ... ]` just above the return, one entry per existing filter, **reusing that filter's existing `options` array and `onChange` closure verbatim** (the closures already call `setCurrentPage(1)` where applicable — keep them).
- Render `<FilterMenu filters={filterDefs} activeCount={<existing count>} onClearAll={<existing clearFilters>} />` in the toolbar's right cluster, immediately before the Sort control.
- Render `{<existingActiveCount> > 0 && <FilterChips filters={filterDefs} onClearAll={<clearFilters>} />}` where the old pill/clear row was.
- Delete the old inline `<FilterDropdown>` pills, the old divider, and the old "N filters / Clear" block.

`FilterDef` shape (already exported): `{ id, label, icon?, multiple?, searchable?, options, value, onChange, defaultValue? }`. `defaultValue` is the single-select "cleared" sentinel — **set it to each filter's real default** (see per-table notes; several default to `"active"`, not `"all"`).

**Flatten (all four tables):**
- Toolbar container: remove `border` and `rounded-lg` (and drop the now-orphaned `h-px bg-border` divider between the top row and the old filter row). Keep `bg-card` and internal padding.
- Column wrapper `gap-*` between toolbar and table: set to `gap-1` (match leads).

---

## 2. Per-table specs

### 2a. Accounts — `src/industries/it-agency/features/accounts/pages/accounts-list.tsx`
- **Toolbar box:** line ~194 `shrink-0 bg-card rounded-lg border` → remove `rounded-lg border`. Drop divider ~line 282. Column wrapper ~line 174 `... gap-2 ...` → `gap-1`.
- **filterDefs (1):**
  - `{ id: "status", label: "Status", multiple: false, searchable: false, defaultValue: "active", options: <existing status options: active/inactive/all>, value: filterStatus, onChange: <existing setter that also setCurrentPage(1)> }`
- Reuse existing `activeFiltersCount` / `clearFilters` (line ~109 / ~115). Sort Popover, New Account (`isAdmin`), search, count label untouched.
- Note: single-filter table — the menu will show one "Status" row. That's fine; keep it for cross-table consistency.

### 2b. Contacts — `src/industries/it-agency/features/crm-contacts/pages/contacts-list.tsx`
- **Toolbar box:** line ~158 `shrink-0 bg-card rounded-lg border` → remove `rounded-lg border`. Drop divider ~line 249. Column wrapper ~line 154 `gap-2` → `gap-1`.
- **filterDefs (2):**
  - `{ id: "account", label: "Account", icon: <Building2/>, multiple: false, searchable: true, defaultValue: "all", options: <existing account options derived from accounts>, value: filterAccountId, onChange: <existing> }`
  - `{ id: "status", label: "Status", multiple: false, searchable: false, defaultValue: "active", options: <existing active/inactive/all>, value: filterStatus, onChange: <existing> }`
- Reuse existing `activeFiltersCount` / `clearFilters` (~line 102 / ~109). Both handlers already `setCurrentPage(1)`.

### 2c. Services — `src/industries/it-agency/features/services/pages/services-list.tsx`
- **Toolbar box:** line ~186 `shrink-0 bg-card rounded-lg border` → remove `rounded-lg border`. Drop divider ~line 273. Column wrapper ~line 166 `gap-2` → `gap-1`.
- Toolbar only renders when `services.length > 0` (empty-state block ~169–182 has none) — keep that condition; just swap what's inside.
- **filterDefs (1):**
  - `{ id: "status", label: "Status", multiple: false, searchable: false, defaultValue: "active", options: <existing active/inactive/all>, value: filterStatus, onChange: <existing> }`
- Reuse existing `activeFiltersCount` / `clearFilters` (~line 101 / ~107).

### 2d. Deals — `src/industries/it-agency/features/deals/pages/deals-workspace.tsx`  (the variation)
- **Toolbar is a single-row bar,** line ~261: `flex flex-wrap items-center gap-2 shrink-0 bg-card border rounded-lg px-3 py-2`. Remove `border rounded-lg` (keep `bg-card px-3 py-2`). Column wrapper ~line 230 `... gap-3` → `gap-1`.
- **This bar contains the pills inline AND a `Sort` FilterDropdown + Export + view toggle.** Replace ONLY the 4 data-filter pills with `<FilterMenu>` placed just before the `flex-1` spacer. **Leave the `Sort` FilterDropdown (`SORT_OPTIONS`), Export, and board/table toggle exactly as they are** — Sort is the sort control, not a data filter; do not fold it into the menu.
- **filterDefs (4), all single-select:**
  - `{ id: "owner", label: "Owner", multiple: false, searchable: true, defaultValue: "all", options: ownerOptions, value: ownerFilter, onChange: <existing> }`
  - `{ id: "type", label: "Deal Type", multiple: false, searchable: false, defaultValue: "all", options: typeOptions, value: typeFilter, onChange: <existing> }`
  - `{ id: "priority", label: "Priority", multiple: false, searchable: false, defaultValue: "all", options: priorityOptions, value: priorityFilter, onChange: <existing> }`
  - `{ id: "created", label: "Created", multiple: false, searchable: false, defaultValue: "all", options: DATE_OPTIONS, value: dateFilter, onChange: <existing> }`
  - (Confirm each filter's real "all"/default sentinel from the code and set `defaultValue` to match.)
- **No pagination here** (board/table view, no `setCurrentPage`) — reuse the existing setters as-is.
- Reuse existing `activeFilterCount` (~line 205) and `clearFilters` (~line 213). Render `<FilterChips>` below the bar, only when `activeFilterCount > 0` (the old inline Clear at ~line 205–219's render site).

---

## 3. Consistency rules
- Match leads-table styling tokens exactly: `FilterMenu` button uses the shared component, so it inherits them. Chips row uses `FilterChips`. Icons from `lucide-react` (Building2 for Account; others optional — omit `icon` if the leads equivalent had none).
- Don't invent new colors/sizes. This should read as "the same toolbar, everywhere."
- Keep every existing gate/condition (`isAdmin` on Add buttons, `services.length > 0`, etc.) byte-for-byte.

---

## 4. Verify before reporting (all required)
1. `npm run build` — clean.
2. `npx eslint <the 4 changed files> --max-warnings 0` — clean (fix any unused imports you orphan, e.g. removed `FilterDropdown`/`Badge`/divider vars).
3. `npx tsc --noEmit` — clean.
4. **Local dev** (`supabase start` if down → `./scripts/local-db-setup.sh` → `npm run dev`; login `admin@edgex.local` / `edgexdev123`, tenant **Test Agency = it_agency**). For **each** of Accounts, Contacts, Services, Deals:
   - Toolbar is flat (no bordered box) and sits tight to the table.
   - `Filters` button present; clicking opens FILTER BY with that table's fields (Accounts/Services: Status only; Contacts: Account + Status; Deals: Owner/Deal Type/Priority/Created).
   - Apply a filter → chip appears, badge counts, rows actually filter, pagination resets to page 1 (Accounts/Contacts/Services).
   - Remove a chip resets just that filter; "Clear all filters" resets everything.
   - Sort / Export / New-*/Add buttons still work; Deals' Sort dropdown and view toggle unchanged.
5. If any it_agency table is empty on local, seed a couple rows or note which you couldn't exercise.

## 5. Report back (for Opus review — do NOT merge)
- Files changed + per-file summary.
- Screenshots per table: flat toolbar, Filters popover open, chips row with an active filter.
- Confirm each §4 item; call out anything unverified.
- Any deviation + why. Commit on `feature/ui-updates-it-agency`, **no PR** until Opus reviews.
```

# BRIEF — Consolidated "Filters" menu for data tables (pilot: New Leads)

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (already created off latest `origin/stage` — work here, do NOT branch again)
**Type:** UI-only. No API, no DB, no migrations, no new dependencies.
**Reviewer:** Opus (me) reviews your report + re-runs gates independently. Stop at the review gate — do NOT open a PR, merge, or deploy.

---

## 1. Goal (what & why)

Today the leads table shows every filter as an always-visible pill in a row under the toolbar
(`All Sources`, `All Counselors`, `All Industries`, `Any time`, `All Status`, …). It's noisy and
eats vertical space.

Replace that row with a **single `Filters` button** in the top-right toolbar (next to `Sort` / `Export`)
that opens a **two-level "FILTER BY" popover** — level 1 lists the available filters (icon + label),
clicking one drills into its option list. Active filters render as **removable chips** in a slim row,
and the `Filters` button carries an **active-count badge**.

**This must be a reusable, config-driven component** — each data table hands it a `FilterDef[]`
describing *its own* fields. This pilot wires it up for **New Leads only**; Deals / Proposals /
Service Catalog / HRMS come in a later pass using the same component.

Reference design: a "Filters" button → dropdown titled **FILTER BY** with icon+label rows and a red
**"Clear all filters"** at the bottom (ChatGPT Projects-style filter menu).

---

## 2. Scope boundaries (do exactly this, nothing more)

**IN scope:**
1. New shared component `src/components/ui/filter-menu.tsx` (config-driven, two-level popover + chips + count).
2. Extract the option-list UI from `filter-dropdown.tsx` into a shared `FilterOptionList` so the leaf
   dropdown and the new menu render options identically (single source of truth). `FilterDropdown`
   must keep working unchanged for its current callers.
3. Wire `FilterMenu` into `src/components/dashboard/leads-table.tsx`: remove the inline pill row,
   add the `Filters` button to the toolbar, add the chips row.

**OUT of scope (do NOT touch):**
- `PipelineBoard.tsx` (has the same pill pattern — it's a follow-up; leave it as-is).
- Any other data table (Deals, Proposals, Service Catalog, HRMS). Pilot is leads only.
- Any filter *logic* — the filtering `useMemo`s, counts, `clearFilters`, `activeFiltersCount`,
  RBAC gating conditions all stay exactly as they are. This is a **presentation refactor only**.
- No API/DB/migration changes. No new npm packages (`SlidersHorizontal` already ships with lucide-react).

---

## 3. Component API — `src/components/ui/filter-menu.tsx`

```tsx
import type { FilterOption } from "./filter-dropdown"; // reuse existing type

export interface FilterDef {
  id: string;                         // stable key, e.g. "source", "counselor"
  label: string;                      // row label in FILTER BY, e.g. "Source"
  icon?: React.ReactNode;             // lucide icon, h-3.5 w-3.5
  multiple?: boolean;                 // false = single-select (radio), true = multi (checkbox)
  searchable?: boolean;               // default true; pass false for short lists (date, status)
  options: FilterOption[];
  value: string | string[];          // current value (string for single, string[] for multi)
  onChange: (value: any) => void;     // existing setter (keeps calling setCurrentPage(1) — see §4)
  defaultValue?: string;             // single-select "cleared" sentinel; default "all"
}

export interface FilterMenuProps {
  filters: FilterDef[];               // per-table config — THIS is the dynamic mechanism
  activeCount: number;                // from caller's activeFiltersCount
  onClearAll: () => void;             // from caller's clearFilters
}
```

**Active-state derivation (match `filter-dropdown.tsx` exactly so behavior is identical):**
- single-select is active when `value !== defaultValue` and `value !== "__all__"`.
- multi-select is active when `(value as string[]).length > 0`.

**Chip summary text (reuse FilterDropdown's `displayLabel` logic):**
- single active → `${label}: ${selectedOption.label}`
- multi, 1 selected → `${label}: ${opt.label}`
- multi, N>1 selected → `${label} (${N})`

---

## 4. Behavior spec

**Trigger button** (place in toolbar — see §5):
- `<SlidersHorizontal className="h-3 w-3" />` + text `Filters`.
- Same button chrome as the existing toolbar buttons: `h-7 px-2.5 text-xs font-medium rounded-md
  border border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]`.
- When `activeCount > 0`: show a count badge on the button (small pill, e.g. `Badge variant="secondary"`
  or a `bg-[#0f0f10] text-white` rounded-full `text-[10px]` circle) and switch the button border to the
  active style `border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]` (matches FilterDropdown active state).

**Level-1 popover ("FILTER BY"):**
- Panel chrome matches FilterDropdown's dropdown: `bg-white rounded-lg shadow-lg border border-gray-200
  z-50`, `align="end"`, width ~`w-64`. Use the shared shadcn `Popover` already imported in leads-table
  (`Popover/PopoverTrigger/PopoverContent`) so outside-click / escape / positioning come for free — do
  NOT hand-roll the click-outside logic.
- Header row: `FILTER BY` in `text-[11px] font-medium uppercase tracking-wide text-muted-foreground`.
- One row per `FilterDef`: `icon` + `label`, full-width button, `hover:bg-[#0000170b]`, `text-xs`.
  If that filter is active, show a small check or its current summary on the right in muted text.
- Footer, only when `activeCount > 0`: red **"Clear all filters"** row (`text-red-600`, `X` icon)
  calling `onClearAll`.

**Level-2 (drill-in):**
- Clicking a level-1 row swaps the panel content to that filter's option list.
- Top of level-2: a back affordance (`ChevronLeft` + the filter's label) returning to level-1.
- Body: the shared `FilterOptionList` (search input when `searchable`, then checkbox rows for multi /
  radio rows for single) — identical visuals to today's FilterDropdown option list.
- Single-select: choosing an option applies it and returns to level-1 (or closes — your call, prefer
  return to level-1). Multi-select: toggling keeps the list open (like today); a "Clear" affordance at
  the bottom when selections exist.
- Keep the panel a stable width across both levels so it doesn't jump.

**Chips row (applied filters):**
- A slim row that renders **only when `activeCount > 0`**, positioned directly under the toolbar
  (this replaces the old always-present filter row — see §5).
- One chip per active filter: the summary text (§3) + an `X`. Clicking `X` resets **that** filter to its
  cleared state (single → `onChange(defaultValue ?? "all")`; multi → `onChange([])`).
- Chip chrome: `inline-flex items-center gap-1 h-6 px-2 rounded-md border border-[#0f0f10]
  bg-[#0000170b] text-[11px] text-[#0f0f10]`.
- Optional trailing "Clear all" ghost button at the end of the chips row (mirror of the popover footer).

**CRITICAL — preserve pagination reset:** every current filter `onChange` body calls `setCurrentPage(1)`.
Reuse the **existing onChange closures** when building the `FilterDef[]` (don't rewrite them), so this is
preserved automatically. When a chip clears a filter, that path must also `setCurrentPage(1)`.

---

## 5. leads-table.tsx integration (precise anchors)

Current toolbar (approx lines 1085–1206): `{filtered.length} Leads` · Search · Edit columns · Kanban ·
`flex-1` spacer · **Sort** · Export · Add Lead.
Current filter pill row + divider: approx **lines 1208–1367** (`{/* Divider */}` through the
`hasActiveFilters` block).

**Changes:**
1. **Add the `Filters` button** into the toolbar's right cluster, immediately **before** the Sort
   `<Popover>` (order becomes: `…spacer · Filters · Sort · Export · Add Lead`).
2. **Build `filterDefs: FilterDef[]`** just above the return, from the existing state — preserving every
   gating condition exactly:
   | id | label | icon | multiple | searchable | gate (keep identical) |
   |----|-------|------|----------|-----------|------------------------|
   | `source` | Source | `Globe` | ✓ | default | `sources.length > 0` |
   | `counselor` | Counselor | `Users2` | ✓ | default | `(isAdmin \|\| isTeamScoped) && counselors.length > 0` |
   | `tag` | Tag | `Tag` | — | default | `showTags` |
   | `industry` | Industry | `Briefcase` | — | default | `showItAgencyFields` |
   | `created` | Date created | `Calendar` | — | **false** | always |
   | `status` | Status | — | — | **false** | always |
   | `form` | Form | — | — | default | `hasMultipleForms` |

   Reuse the **exact `options` arrays and `onChange` closures** currently passed to each `<FilterDropdown>`
   (lines 1214–1346) — copy them into the `FilterDef` objects, do not re-derive.
3. **Remove** the inline pill row + its divider + the old `hasActiveFilters` "N filters / Clear" block
   (lines ~1208–1367). Replace with the new **chips row** rendered under the toolbar
   (`{activeCount > 0 && <chips row/>}`).
4. Pass `activeCount={activeFiltersCount}` and `onClearAll={clearFilters}` (both already exist).

Leave the Sort popover, Export, Add Lead, Edit columns, Kanban, Search, and the count label untouched.

---

## 6. Styling / consistency rules

- Match existing tokens: heights `h-7` (buttons) / `h-6` (chips, badges), `text-xs` / `text-[11px]`,
  borders `border-gray-300`, active `border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]`, hover
  `hover:bg-[#0000170b]`, brand black `#0f0f10`.
- Reuse shadcn `Popover` and `Badge` (already imported in leads-table). Icons from `lucide-react`.
- No inline hex outside the tokens already used in this file. Keep it visually identical to the current
  filter dropdowns — this should feel like a reorganization, not a redesign.

---

## 7. Verify before reporting (all required)

1. `npm run build` — clean.
2. `npx eslint src/components/ui/filter-menu.tsx src/components/ui/filter-dropdown.tsx
   src/components/dashboard/leads-table.tsx --max-warnings 0` — clean.
3. **Local dev** (`supabase start` if down → `./scripts/local-db-setup.sh` → `npm run dev`;
   login `admin@edgex.local` / `edgexdev123`, tenant **Test Agency = it_agency**):
   - New Leads → toolbar shows `Filters` (not the old pill row). Click it → "FILTER BY" list with the
     it_agency filters (Source, Counselor, **Industry** present, **Tag** absent), Date created, Status, and
     Form only if multiple forms exist.
   - Drill into Source (multi) → toggle values → list stays open → chips appear → badge shows count.
   - Drill into Status (single) → pick one → applies, chip appears.
   - Remove a single chip → that filter resets, others persist, table + pagination update.
   - "Clear all filters" (popover footer + chips-row button) → all reset, chips + badge gone,
     `currentPage` back to 1.
   - Every filter still actually filters the rows (counts in option labels still render).
4. **RBAC / industry gating unchanged:** as a **counselor**, Counselor filter is hidden. On an
   **education_consultancy** tenant, **Tag** shows and **Industry** is hidden (flip `.env.local` to stage
   with `cp .env.stage.local .env.local`, or use an education tenant, to spot-check — note in report if
   you couldn't).
5. Narrow the window → toolbar stays on one line, no wrapping mess (the whole point of collapsing).

---

## 8. Report back (for Opus review — do NOT merge)

- Files changed + brief per-file summary.
- Screenshots: New Leads toolbar with `Filters` closed, level-1 popover open, level-2 drill-in, and
  chips row with 2–3 active filters + badge.
- Confirmation each §7 item passed (call out anything you couldn't verify, e.g. education-tenant check).
- Any deviation from this brief and why.
- Leave it on `feature/ui-updates-it-agency`, committed, **not pushed as a PR** until Opus reviews.
```

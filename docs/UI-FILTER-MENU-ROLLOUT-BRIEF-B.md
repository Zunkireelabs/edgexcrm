# BRIEF B — FilterMenu + flat toolbar for the two boards (Pipeline Board, Project Board header)

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (same branch — do NOT branch again)
**Type:** UI-only. No API, no DB, no migrations, no new dependencies.
**Reviewer:** Opus reviews + re-runs gates. **Stop at the review gate — no PR, no merge, no deploy.**
**Depends on:** the committed `FilterMenu`/`FilterChips`/`FilterDef` in `src/components/ui/filter-menu.tsx`, and the migrated `leads-table.tsx` + the 4 list tables (Brief A) as worked examples.

These two are the higher-risk surfaces (view-gated / prop-controlled / RBAC-gated / one shared component). **Commit them as two separate commits** so each can be reviewed/reverted independently.

---

## 0. Goal (same as Brief A, two harder files)

Replace the inline `<FilterDropdown>` pills in each board's toolbar with a single **`<FilterMenu>`** + **`<FilterChips>`** row built from a per-file `FilterDef[]`, and **flatten the toolbar** (remove the `rounded-lg border` box, drop the internal divider, tighten the gap) to match the 5 tables already done.

**Universal rule — reuse, don't rewrite:** for every existing `<FilterDropdown>`, copy its exact props (`label`, `multiple`, `searchable`, `icon`, `options`, `value`, `onChange`) into a `FilterDef`, and **preserve the exact gate condition that currently wraps it** by conditionally pushing that def into the array. Do NOT change any filter's single-vs-multi nature, options, handlers, or gating. Neither board is paginated, so there is no `setCurrentPage(1)` to preserve.

**Out of scope (do NOT touch):** the 5 already-migrated tables, Proposals list, any API/DB, and — on Project Board — the non-`FilterDropdown` controls (the "Show cancelled" `Checkbox`, the task-status chip row, the priority chips). Leave all of those exactly as-is. On both boards, leave the **Sort** control, **Export**, and **Add** buttons byte-for-byte.

---

## PART 1 — Pipeline Board — `src/components/pipeline/PipelineBoard.tsx`

> ⚠️ **SHARED / UNIVERSAL COMPONENT.** This lives in `src/components/pipeline/` and is used by the kanban/pipeline view of **every industry**, not just it_agency. Your change ships to education tenants too. The filter *gates* already preserve per-industry behavior (the Industries filter only renders for it_agency); keep them intact so behavior is unchanged everywhere. Rebase carefully before any PR — this is a shared file.

- **Toolbar box:** container line ~573 `shrink-0 bg-card rounded-lg border` → remove `rounded-lg border` (→ `shrink-0 bg-card`). There is a skeleton/loading variant around line ~540 with the same classes — flatten it too so loading and loaded states match. Drop the `h-px bg-border` divider (~line 678). Root wrapper line ~571 `flex flex-col flex-1 min-h-0 gap-2` → `gap-1`.
- **Add `<FilterMenu>`** in the top row's right cluster, immediately before the **Sort** Popover. Leave Sort (shadcn Select), Export (`isAdmin`), and Add Lead (`canCreateLead`) untouched.
- **filterDefs — build conditionally, preserving each existing gate (all single-select unless the current code says `multiple`):**
  | id | label | icon | searchable | gate (keep identical) | value / onChange |
  |----|-------|------|-----------|------------------------|------------------|
  | `counselor` | All Counselors | Users2 | true | `isAdmin` | `counselorFilter` / existing |
  | `source` | All Sources | Globe | (as-is) | `sources.length > 0` | `sourceFilter` / existing |
  | `industry` | All Industries | Briefcase | (as-is) | `industryId === "it_agency"` | `industryFilter` / existing |
  | `created` | Any time | Calendar | false | always | `createdFilter` / existing |

  Reuse the exact `options` arrays currently passed to each pill (counselor: `all`/`unassigned` + derived team members; source: derived; industry: `all` + `PROSPECT_INDUSTRIES` + `__none__`; created: `all`/`today`/`week`/`month`). Set each `defaultValue` to its real "cleared" sentinel (these use `"all"` / empty, per the code — confirm and match).
- **Render `<FilterChips>`** where the old "N filters / Clear" block was (~lines 761–769), gated on the existing `activeFiltersCount > 0`. Pass `activeCount={activeFiltersCount}` and `onClearAll={clearFilters}` (existing, ~338–352).

---

## PART 2 — Project Board header — `src/industries/it-agency/features/project-board/components/workspace-header.tsx`

> This component is **prop-controlled** — it has NO local filter `useState`. Filter state comes in via the `filters` prop (from the `use-workspace-filters` hook) and changes via the `onFilterChange` / `onClearFilters` props. Build each `FilterDef.value` from `filters.*` and each `onChange` to call `onFilterChange(...)` **exactly as the current inline pills already do** — copy those closures verbatim.

> The filters are **view-gated by `filters.view`.** This is the crux: the `FilterDef[]` must be assembled conditionally on the same `isBoardOrTable` / `isTasksOrMembersView` / `isMembersView` booleans that currently wrap each pill, so each view shows exactly the filters it shows today.

- **Toolbar box:** container line ~218 `shrink-0 bg-card rounded-lg border` → remove `rounded-lg border`. Drop divider (~line 240). Root wrapper line ~189 `flex flex-col gap-3` → `gap-1`.
  - The board/table itself is rendered by the **parent page**, not this file — so the header↔board gap lives in the parent. Locate the parent that composes `<WorkspaceHeader>` + the board (likely under `src/industries/it-agency/features/project-board/pages/`) and set its column-wrapper gap to `gap-1` to match. If the parent gap is already tight, note it and leave it.
- **Add `<FilterMenu>`** into the top row (which currently holds count + search only). Because filters are view-gated, when a view yields an **empty** `filterDefs`, either hide the `Filters` button or show it disabled — pick hide (cleaner). 
- **filterDefs — build conditionally on `filters.view`, preserving current gates:**
  | id | label | multiple | searchable | gate (keep identical) | value / onChange |
  |----|-------|----------|-----------|------------------------|------------------|
  | `account` | Account | false | true | all views | `filters.accountId` / existing |
  | `owner` | Owner | false | (as-is) | `isBoardOrTable || isMembersView` | `filters.ownerId` / existing |
  | `status` | Status | **true** | false | `isBoardOrTable` | `filters.statuses` / existing |
  | `assignee` | Assignee | false | (as-is) | `isTasksOrMembersView` | `filters.assigneeId` / existing |
  | `due` | Due | false | false | `isTasksOrMembersView` | `filters.due` / existing |

  Reuse the derived `accountOptions` / `ownerOptions` / `statusOptions` (from `availableChips`) / `assigneeOptions` / `DUE_OPTIONS` arrays as-is. **`status` is multi-select** — keep `multiple: true`, value `filters.statuses` (array), and the existing onChange that updates the statuses array via `onFilterChange`.
- **Leave untouched:** the `Show cancelled` `Checkbox` (`isBoardOrTable`), the task-status chip row (`isTasksView`), and the priority chips — these are not `FilterDropdown`s and stay exactly where they are.
- **Render `<FilterChips>`** where the old inline Clear lived, gated on the existing `activeFiltersCount > 0`. Pass `activeCount={activeFiltersCount}` (existing, ~178–185) and `onClearAll={onClearFilters}` (the prop, used at ~line 325).

---

## 3. Verify before reporting (all required)

1. `npm run build` — clean.
2. `npx eslint src/components/pipeline/PipelineBoard.tsx src/industries/it-agency/features/project-board/components/workspace-header.tsx <the project-board parent page you edited> --max-warnings 0` — clean (remove any orphaned imports/vars: `FilterDropdown`, `Badge`, divider vars).
3. `npx tsc --noEmit` — clean.
4. **Local dev** (`supabase start` if down → `./scripts/local-db-setup.sh` → `npm run dev`; tenant **Test Agency = it_agency**, login `admin@edgex.local` / `edgexdev123`):
   - **Pipeline Board** (kanban view of leads, e.g. `/leads?...&view=kanban` or the pipeline route): flat toolbar; `Filters` opens with Counselors (admin only) / Sources / **Industries (it_agency)** / Any time; applying a filter narrows the board columns; chips + badge work; Clear resets; Sort/Export/Add Lead unchanged. Also confirm the **loading skeleton** toolbar is flat.
   - **Project Board** (it_agency project-board route): flat toolbar; switch **views** (board → table → tasks → members) and confirm the `Filters` list changes per view (Status only in board/table; Assignee/Due only in tasks/members; Owner in board/table/members; Account always); Status multi-select toggles multiple values; chips reflect them; "Show cancelled" checkbox + task-status/priority chip rows still render and work; Clear resets.
5. **Cross-industry check for Pipeline Board (critical — it's shared):** switch `.env.local` to stage (`cp .env.stage.local .env.local`) or use an **education_consultancy** tenant, open its kanban/pipeline, and confirm: toolbar flat, `Filters` shows Sources/Counselors/Any time but **NOT Industries** (that gate is it_agency-only), everything still filters. If you can't reach an education tenant locally, say so — Opus will verify.

## 4. Report back (for Opus review — do NOT merge)
- Files changed (should be Pipeline Board + Project Board header + one project-board parent page) + per-file summary, as **two separate commits**.
- Screenshots: each board's flat toolbar, Filters popover open (Project Board: show two different views to prove view-gating), chips row active. Include the education-tenant Pipeline Board (Industries absent) if reachable.
- Confirm each §3 item; call out anything unverified (esp. the cross-industry check).
- Any deviation + why. Commit on `feature/ui-updates-it-agency`, **no PR** until Opus reviews.
```

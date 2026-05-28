# `/projects` Board chrome — design pass

> Bring the IT-agency `/projects` Board view's chrome in line with `/pipeline`'s kanban visual vocabulary. **No card-content changes** — pure chrome work.

---

## Goal

`/projects` Board (`workspace.tsx` → `BoardView`) currently has:

1. A **bright-blue solid-pill row** for filtering by project status (Discovery / In Progress / Review / Delivered / On Hold) that's the loudest mismatch with the design-pass tokens established in `f3ad73d`, `8791e66`, `aec9cf5`.
2. **Bare kanban column headers** — plain text + count chip, no visual anchor.
3. **Sparse empty-column state** — `"No projects"` plain text in a dashed box.
4. A **bright-blue `isOver` highlight** when dragging a card over a column (`ring-2 ring-blue-300`).

`/pipeline` (`PipelineColumn.tsx`, already on-token) has:

1. Compact FilterDropdowns for All Counselors / All Sources / Any time — no chip rows.
2. Column header with **colored dot** + name + count chip, in a bordered card header.
3. Bordered column body with subtle `bg-muted/20` fill + droppable area.
4. Empty state: icon-in-circle + "No leads" + "Drag leads here to update".
5. Footer with Total / Avg. time.

This brief brings the Projects Board chrome to that vocabulary, **except** the column footer (per Sadin's call — projects are fewer per column and the per-card billable hours already surface what matters).

---

## Scope (and what's out of scope)

### In scope

1. Collapse the **Project Status pills row** into a single multi-select `FilterDropdown` placed in Row 2 alongside Account / Owner.
2. Extend `FilterDropdown` to support multi-select via a new optional `multiple?: boolean` prop (preserves all 13 existing single-select call sites unchanged).
3. Restructure **`ProjectColumn`** chrome to mirror `PipelineColumn`: bordered header bar with colored dot + name + count chip, bordered body with subtle fill, retoned `isOver` (no blue).
4. Replace the **empty-column state** with the `PipelineColumn` pattern (icon-in-muted-circle + headline + helper text).
5. Hardcode a **status → color map** for the column-header dots (projects don't have configurable stage colors the way pipelines do — they're enum statuses).

### Out of scope (explicit)

- **Task status chips on Tasks view** (Row 3 conditional when `view === "tasks"`) — same blue treatment. Worth retoning later in a follow-up brief; not Sadin's ask today.
- **Priority chips on Tasks + Members views** — the colored variants (low gray, normal blue, high amber, urgent red) are intentional and a hierarchy signal. Don't touch.
- **Column footer totals** (Total / Avg. time) — per Sadin, skip for projects.
- **Project card content** — name link, account + avatar, contact count, billable hours, "Updated Xd ago". Keep exactly as-is per Sadin's "we keep all the infos".
- **Account / Owner / Assignee / Due FilterDropdowns** in Row 2 — already use the retoned `FilterDropdown` correctly.
- **"Show cancelled" checkbox** — no Pipeline equivalent; keep as-is.
- **View tabs (Board / Table / Tasks / Members)** — already on token.
- **Drag-drop logic** — `BoardView.handleDragStart/End`, TOCTOU precondition, sensors. Untouched. Pure visual chrome.
- **Column width** (`min-w-[220px] w-[220px]`) — Projects content is denser per card than Pipeline; the 220px density is intentional. Don't widen to 320px.

---

## The changes

### Change 1 — extend `FilterDropdown` with optional `multiple` mode

**File:** `src/components/ui/filter-dropdown.tsx`

**Why:** all 13 existing call sites are single-select with `value: string` + `onChange: (value: string) => void`. The Project Status filter needs multi-select. Cleanest path is to extend `FilterDropdown` with a discriminated `multiple?: boolean` prop — single-select callers stay unchanged.

**Implementation:**

Use a TypeScript discriminated union on props:

```ts
type FilterDropdownProps =
  | {
      label: string;
      multiple?: false;
      value: string;
      onChange: (value: string) => void;
      options: FilterOption[];
      icon?: React.ReactNode;
      searchable?: boolean;
    }
  | {
      label: string;
      multiple: true;
      value: string[];
      onChange: (next: string[]) => void;
      options: FilterOption[];
      icon?: React.ReactNode;
      searchable?: boolean;
    };
```

Behavioral differences when `multiple === true`:

- **Trigger label**:
  - 0 selected: show `label` (e.g. `"Status"`)
  - 1 selected: show `label: <option.label>` (e.g. `"Status: Discovery"`)
  - ≥2 selected: show `label (N)` (e.g. `"Status (3)"`)
- **`isActive`** for the active-trigger styling: `value.length > 0` (instead of `value !== "all"`).
- **Selection indicator** in the dropdown row: render a small rounded *square* checkbox instead of the radio circle, with the same `#0f0f10` filled-when-selected color treatment. Use a `<Check className="w-2 h-2 text-white" />` glyph when selected (same as the radio uses).
- **Click handler**: instead of `handleSelect` closing the dropdown and replacing `value`, toggle the option in/out of the `value: string[]` array and **keep the dropdown open**. Do not clear the search query on toggle (let the user keep filtering across selections).
- **Optional "Clear" affordance**: when `value.length > 0`, render a small `"Clear"` text button at the bottom of the dropdown panel (`text-xs text-muted-foreground hover:text-foreground underline`) that calls `onChange([])`. Match how `Clear` is already done elsewhere in the codebase (e.g. `workspace-header.tsx:307-310`).

Keep the rest of the component identical — same panel chrome (`rounded-lg shadow-lg border border-gray-200`), same arrow pointer, same search box, same `hover:bg-[#0000170b]`, same `#0f0f10` selection color.

**Type narrowing inside the component**: do the `if (multiple)` branch at the top of `handleSelect` (or split into `handleSelectSingle` / `handleSelectMulti`) so the TS narrowing is clean. The `selectedOption` / `displayLabel` derivations also need a multi branch.

**Why the discriminated-union approach (not a `multiple?: boolean` with a single broader prop type):** TypeScript will catch every existing call site if the multi-mode signature drifts, since the single-select branch has no `multiple` field set. Adds zero risk of accidentally breaking the 13 existing usages.

### Change 2 — collapse Project Status chips into the new multi-select dropdown

**File:** `src/industries/it-agency/features/project-board/components/workspace-header.tsx`

**Why:** the current Row 3 status-chips strip (lines 280–313) is the loudest blue-pill remnant. Sadin's call: retone as a multi-select dropdown rather than retone-in-place.

**Implementation:**

1. **Remove** the Row 3 block entirely (the `isBoardOrTable && (<div>... Status chips ...</div>)` JSX, lines 280–313).
2. **Remove** the helper functions `toggleProjectStatus` and `isProjectStatusActive` (lines 131–141) — no longer needed.
3. **Add** a new `FilterDropdown` call in Row 2, placed *after* Owner (line 236) and *before* the conditional Assignee block (line 239):

```tsx
{isBoardOrTable && (
  <FilterDropdown
    label="Status"
    multiple
    value={filters.statuses}
    onChange={(next) => onFilterChange({ statuses: next as ProjectStatus[] })}
    options={statusOptions}
    searchable={false}
  />
)}
```

4. **Build** `statusOptions` near the other `*Options` arrays (around lines 112–125):

```tsx
const statusOptions: FilterOption[] = availableChips.map((chip) => ({
  value: chip.value,
  label: chip.label,
}));
```

(Use the existing `availableChips` variable from line 127 — already accounts for the `Show cancelled` toggle.)

5. **Confirm** the underlying `WorkspaceFilters.statuses` is already `ProjectStatus[]` (it is — `BoardView.tsx:65` reads `filters.statuses.includes(s)`). The cast `(next as ProjectStatus[])` is needed because the multi-select returns `string[]`; the cast is safe because the only option values are valid `ProjectStatus` strings.

6. **Keep `searchable={false}`** — only 5–6 status options; a search box would be visual noise.

7. **Do not remove** the `STATUS_CHIPS` / `CANCELLED_CHIP` constants — they're still used by `availableChips` to compute the options array.

### Change 3 — restructure `ProjectColumn` chrome to mirror `PipelineColumn`

**File:** `src/industries/it-agency/features/project-board/components/project-column.tsx`

**Reference file:** `src/components/pipeline/PipelineColumn.tsx` — copy the chrome pattern.

**Implementation:**

1. **Add a status-color map** as a module-level const next to `COLUMN_CONFIG`:

```tsx
export const STATUS_COLOR: Record<ProjectStatus, string> = {
  planning:  "#3B82F6", // blue   — Discovery (start state)
  active:    "#F59E0B", // amber  — In Progress (work happening)
  in_review: "#A855F7", // purple — Review (needs attention)
  delivered: "#10B981", // green  — Delivered (success)
  on_hold:   "#9CA3AF", // gray   — On Hold (muted)
  cancelled: "#EF4444", // red    — Cancelled (terminal)
};
```

Rationale: matches common Kanban conventions; the colors are picked from Tailwind's 500-level palette so they read at small sizes (3×3 dot). If Sadin wants different hues, this is the one place to edit. Document this in the brief postmortem if the colors land.

2. **Replace the existing render** (the bare `flex flex-col gap-2` wrapper) with the bordered card pattern from `PipelineColumn.tsx:36–87`:

```tsx
return (
  <div
    className={[
      "flex flex-col min-w-[220px] w-[220px]",
      cfg.muted ? "opacity-60" : "",
    ].filter(Boolean).join(" ")}
  >
    {/* Header bar */}
    <div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0 border-gray-200">
      <div
        className="h-2.5 w-2.5 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLOR[status] }}
      />
      <h3 className="text-sm font-semibold text-[#0f0f10] truncate flex-1">{cfg.label}</h3>
      <span className="text-xs text-[#787871] bg-gray-100 rounded-full px-2 py-0.5 font-medium">
        {projects.length}
      </span>
    </div>

    {/* Header divider */}
    <div className="h-px bg-gray-200" />

    {/* Droppable body */}
    <div
      ref={setNodeRef}
      className={[
        "flex-1 overflow-y-auto space-y-2 p-2 border border-t-0 bg-gray-50/40 transition-colors min-h-40 rounded-b-lg",
        isOver
          ? "border-[#0f0f10] bg-[#0000170b]"
          : "border-gray-200",
      ].join(" ")}
    >
      {projects.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center h-32 text-center px-4">
          <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center mb-2">
            <FolderOpen className="h-5 w-5 text-[#787871]" />
          </div>
          <p className="text-sm text-[#0f0f10] font-medium">No projects</p>
          <p className="text-xs text-[#787871] mt-0.5">Drag projects here to update</p>
        </div>
      ) : (
        projects.map((p) => (
          <ProjectCard key={p.id} project={p} teamMap={teamMap} hoursMap={hoursMap} />
        ))
      )}
    </div>
  </div>
);
```

3. **Imports**: add `import { FolderOpen } from "lucide-react";` at the top. `FolderOpen` is the right empty-state icon for projects (matches the LayoutGrid + folder semantic Sadin already uses elsewhere).

**Notes on the implementation:**

- **Column width**: kept at `min-w-[220px] w-[220px]` per the scope decision. Projects content is denser per card than Pipeline leads; don't widen to 320px.
- **`isOver` colors**: swapped from `ring-2 ring-blue-300 ring-inset rounded-lg` to `border-[#0f0f10] bg-[#0000170b]`. Uses the design-pass token, no blue.
- **Header bar background**: `bg-card` is the white-card background (`#ffffff` in light mode per `globals.css`). Matches Pipeline.
- **Body background**: `bg-gray-50/40` — subtler than Pipeline's `bg-muted/20` because the page itself is already on `#fafafa` chrome (per the dashboard chrome restyle from `ec310f1`). Adjust to taste if it looks too uniform with the page background.
- **Count chip**: retoned from `bg-muted` to `bg-gray-100` to match the established design-pass treatment (see `accounts-list.tsx` status pill convention).
- **Header colors**: name uses `text-[#0f0f10]` (primary-text token), count uses `text-[#787871]` (secondary-text token) — matches the design pass.
- **Sticky-header consideration**: the kanban scrolls horizontally (parent `overflow-x-auto`). Inside each column there's no vertical scroll today (the page scrolls), so don't sticky the header. Pipeline does have vertical column-internal scroll because of `flex-1 overflow-y-auto` on the body — Projects doesn't have a defined max-height, so each column grows. **Don't add a max-height** without Sadin's call; it changes behavior the existing user is used to.

---

## Files to touch

| File | Change |
|---|---|
| `src/components/ui/filter-dropdown.tsx` | Add `multiple` mode via discriminated-union props; render checkbox-shaped selection indicator + count-in-label; keep dropdown open on toggle; optional Clear button. |
| `src/industries/it-agency/features/project-board/components/workspace-header.tsx` | Add `statusOptions`; insert Status `FilterDropdown` in Row 2 (Board + Table views only); remove Row 3 status-chips JSX (lines 280–313); remove `toggleProjectStatus` + `isProjectStatusActive` helpers. |
| `src/industries/it-agency/features/project-board/components/project-column.tsx` | Add `STATUS_COLOR` map; rewrite render to bordered header + body + empty state mirroring `PipelineColumn`; swap blue `isOver` for design-token treatment; add `FolderOpen` import. |

**Total: 3 files. ~150 LOC net. UI-only — no DB, no API, no new routes.**

---

## Patterns to reuse (from existing files)

- **Pipeline column chrome**: `src/components/pipeline/PipelineColumn.tsx` — copy the bordered header + body + empty state structure verbatim, swap content where needed.
- **FilterDropdown component**: `src/components/ui/filter-dropdown.tsx` — the existing single-select shape is the base. Don't introduce new dropdown chrome or new tokens.
- **Design-pass color tokens** (see `docs/archive/features/DESIGN-PRIMARY-BUTTON-BRIEF.md`, `DESIGN-TEXT-HIERARCHY-BRIEF.md`, `DESIGN-DROPDOWN-RETONE-BRIEF.md`):
  - Primary text: `#0f0f10`
  - Secondary text: `#787871`
  - Dropdown hover overlay: `#0000170b`
  - Active border on dropdown trigger: `#0f0f10`
  - Status pill / count chip bg: `bg-gray-100`

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (this is the CI hard gate — local builds don't run ESLint).
- [ ] `/projects` Board view:
  - Status FilterDropdown appears between Owner and (where applicable) Show cancelled.
  - Opening Status shows the 5–6 status options as checkboxes.
  - Selecting one option closes nothing — dropdown stays open. Toggling on/off updates the visible kanban columns.
  - Trigger label transitions: `"Status"` (none) → `"Status: Discovery"` (1) → `"Status (3)"` (3).
  - Clearing all selections via Clear button restores all columns (length 0 = show all).
  - Old blue chip row is gone.
- [ ] `/projects` Board column visuals:
  - Each column header has a colored dot matching the status.
  - Header bar reads `bg-card` (white) with rounded top corners and border.
  - Empty columns show the folder icon + "No projects" + "Drag projects here to update".
  - Drag-over highlight is near-black overlay, not blue ring.
- [ ] `/projects` Table view: status filter still works (FilterDropdown is rendered for Table view too per `isBoardOrTable`).
- [ ] `/projects` Tasks view: task status chips (the conditional Row 3 for Tasks) are **untouched** — still showing the blue-pill treatment. Document this in the postmortem; out of scope.
- [ ] Drag a project from Discovery → In Progress: the optimistic update + TOCTOU precondition still works. The retoned `isOver` highlight is visible during drag.
- [ ] Existing FilterDropdown call sites compile and render unchanged: `/leads`, `/accounts`, `/contacts`, `/pipeline`, `/projects` Account/Owner/Assignee/Due dropdowns. Spot-check Sadin's smoke list.
- [ ] All 6 code-review checklist items N/A — UI-only, no DB / no API / no new page / no Radix Select / no embed / no mutations. (Same as the design-pass first wave.)

---

## Sonnet handoff prompt

Copy-paste the block below to a fresh Sonnet session.

```
You're implementing a UI-only design-pass change on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/PROJECTS-BOARD-CHROME-BRIEF.md end-to-end before touching any code — it has the full scope, the file list, the exact patterns to mirror from existing code, and the verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b chore/projects-board-chrome origin/stage
2. Implement the 3 file changes per the brief:
   - src/components/ui/filter-dropdown.tsx — add `multiple` mode via discriminated-union props (don't break the 13 existing single-select call sites).
   - src/industries/it-agency/features/project-board/components/workspace-header.tsx — collapse the Project Status chip row into a new multi-select Status FilterDropdown placed in Row 2.
   - src/industries/it-agency/features/project-board/components/project-column.tsx — restructure to mirror PipelineColumn (bordered header bar + colored dot + body + empty state); swap blue `isOver` for the design-token treatment.
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — this is the CI hard gate, local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief.
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief:
- Pure chrome work. Do NOT change project card content (name/account/contact-count/billable-hours/updated-ago all stay).
- Do NOT touch the Task status chips on Tasks view (different concern; separate brief later).
- Do NOT touch Priority chips — their colors are intentional.
- Do NOT widen columns to 320px — Projects content is denser; keep 220.
- Do NOT add column footer totals — Sadin explicitly skipped these for projects.
- Reference PipelineColumn.tsx for chrome patterns and copy verbatim where the brief points to it.
- All design tokens come from prior commits: primary text `#0f0f10`, secondary `#787871`, dropdown hover `#0000170b`, active border `#0f0f10`. Do not invent new tokens.

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing.
```

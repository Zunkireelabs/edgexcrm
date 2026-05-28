# `/projects` Board → `/pipeline` visual parity

> Second pass on the IT-agency `/projects` Board view. The first chrome brief (`PROJECTS-BOARD-CHROME-BRIEF.md`, shipped as `6de03ab`) closed the loudest mismatches (blue chip strip, column header dots, empty state). This brief closes the remaining gaps Sadin called out: toolbar layout, card density and structure, column width / footer, and the LayoutGrid icon. Goal is to make `/projects` Board indistinguishable from `/pipeline` in visual vocabulary — same toolbar shape, same card pattern, same column width and footer.

---

## Goal

After the first brief, `/projects` Board has:
- ✓ Multi-select Status FilterDropdown (not blue chips)
- ✓ Bordered kanban columns with colored status dots
- ✓ Icon-in-circle empty state
- ✓ Design-token `isOver` (no blue ring)

But `/projects` is still visually unlike `/pipeline` in three areas:

1. **Toolbar layout**. `/pipeline` has a count chip + search + (right-aligned) Sort/Export/Add buttons on top, with a divider and a separate filter row below. `/projects` jams title + view tabs in one row and search + every filter dropdown in another, with no toolbar card and no internal divider.
2. **Card structure and density**. `/pipeline`'s `LeadCard` is `rounded-xl border bg-card p-4` with 3 sections (header + key:value metadata grid + footer with urgency badge and assignee avatar) separated by dividers. `/projects`'s `ProjectCard` is wrapped in shadcn `<Card>` with all content inline at `p-3`, no dividers, no urgency, no menu, much denser.
3. **Column width and footer**. `/pipeline` columns are 320px wide with a Total/Avg footer at the bottom. `/projects` columns are 220px wide with no footer.

This brief closes all three.

---

## Scope

### In scope

1. **Restructure `WorkspaceHeader`** into pipeline's toolbar pattern: title row, then a bordered toolbar card containing a top row (count chip + search + spacer) and a filter row underneath, separated by an internal divider.
2. **Drop the LayoutGrid icon** next to "Projects" title — mirror `/pipeline`'s plain text title.
3. **Rebuild `ProjectCard`** with `LeadCard`'s structural pattern: 3 sections (header with icon-square + name + dropdown menu / divider / key:value metadata grid / divider / footer with urgency badge + owner avatar). Whole card clickable (onClick navigates) while preserving keyboard a11y via a `<Link>` on the name.
4. **Widen `ProjectColumn`** from 220px to 320px (matching `PipelineColumn`).
5. **Re-add column footer** to `ProjectColumn`: `Total: N projects / Billable: X.X hrs`. (Sadin previously skipped this; now wants it back for consistency.)
6. **Move the owner avatar** from the card header (current) to the card footer (LeadCard pattern).
7. **Surface project count** from `workspace.tsx` to `WorkspaceHeader` via a new prop.

### Out of scope (explicit)

- **Project card data fields**: same data as today — `name`, `account_name`, `contact_count`, `billable_hrs` (derived), `updated_at`, `owner`. No new fields. The restructure just reshapes how they appear.
- **`+ New Project` button** in the toolbar. The existing `ProjectForm` (`src/industries/it-agency/features/accounts/components/project-form.tsx`) requires `accountId` as a prop — adding a top-level "+ New Project" would require extending the form with an account picker. Out of scope; create projects from `/accounts/[id]` as today. **Flagged for a follow-up brief if Sadin wants it.**
- **Sort / Export buttons** in the toolbar top row. `/pipeline` has these because lead data is searchable + exportable. `/projects` doesn't have a Sort popover or CSV export today. Out of scope; flagged as follow-ups.
- **Direct reuse of `LeadCard`/`PipelineColumn` components** — their props are pipeline-shaped (`PipelineLead`, `PipelineStage` with DB-stored color). Rebuild ProjectCard/ProjectColumn to *visually and structurally match* the pattern.
- **Task status chips / Priority chips / Tags picker** on Tasks/Members views. Same blue treatment, separate concern.
- **Table view / Tasks view / Members view** — only the Board view chrome changes here. Other views can be aligned in follow-up briefs.
- **`workspace.tsx`** changes beyond passing `count` to `WorkspaceHeader`.
- **Drag-drop logic** (TOCTOU precondition, sensors, `BoardView.handleDragEnd`). Untouched.
- **Show Cancelled checkbox** — stays as a small inline checkbox in the filter row. Moving it into the Status dropdown is a UX change that warrants its own thought.

---

## The changes

### Change 1 — toolbar restructure (`workspace-header.tsx` + `workspace.tsx`)

**Reference**: `src/components/pipeline/PipelineBoard.tsx:552-720` (the non-skeleton toolbar starting from `<div className="shrink-0 bg-card rounded-lg border">`).

**Implementation**:

1. **Title row** (above the toolbar card): keep the existing flex row. Drop the `<LayoutGrid />` icon prefix on the heading — match Pipeline's plain text title. Keep the view-toggle Tabs on the right.

   ```tsx
   <div className="flex items-center justify-between">
     <h1 className="text-xl font-semibold">Projects</h1>
     <Tabs value={filters.view} onValueChange={…}>
       <TabsList>… Board/Table/Tasks/Members …</TabsList>
     </Tabs>
   </div>
   ```

2. **Toolbar card** (replaces current Row 2 + Row 3). One `<div className="shrink-0 bg-card rounded-lg border">` wraps both rows.

3. **Top row** of the toolbar card: count chip + search + spacer. No Add/Sort/Export buttons (see scope notes).

   ```tsx
   <div className="flex flex-wrap items-center gap-3 p-3">
     <div className="text-sm font-medium text-muted-foreground shrink-0">
       {count} {count === 1 ? "Project" : "Projects"}
     </div>
     <div className="relative w-60">
       <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
       <input
         ref={searchRef}
         type="text"
         value={filters.q}
         onChange={(e) => onFilterChange({ q: e.target.value })}
         placeholder={isTasksView ? "Search tasks…" : isMembersView ? "Search projects & tasks…" : "Search projects…"}
         aria-label="Search"
         className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
       />
     </div>
     <div className="flex-1" />
   </div>
   ```

   - Search bar is now `h-9 w-60` (was `h-7 w-44`) to match Pipeline.
   - Count copy: `"5 Projects"` (or `"1 Project"` for singular).

4. **Internal divider**:
   ```tsx
   <div className="h-px bg-border" />
   ```

5. **Filter row** of the toolbar card: all FilterDropdowns + Show Cancelled checkbox + spacer + active-filters indicator. Use `flex flex-wrap items-center gap-1.5 px-3 py-2` (matches Pipeline).

   Position order: Account → Owner (board/table/members only) → Status (board/table only) → Assignee (tasks/members) → Due (tasks/members) → Show Cancelled checkbox (board/table only) → flex-1 spacer → active-filters indicator (only when any filter is non-default).

   Active-filters indicator (mirror Pipeline `PipelineBoard.tsx:705-718`):

   ```tsx
   {hasActiveFilters && (
     <div className="flex items-center gap-1.5">
       <Badge variant="secondary" className="text-[11px] font-normal h-6 px-2">
         {activeFiltersCount} filter{activeFiltersCount !== 1 ? "s" : ""}
       </Badge>
       <button
         type="button"
         onClick={onClearFilters}
         className="text-xs text-muted-foreground hover:text-foreground underline"
       >
         Clear
       </button>
     </div>
   )}
   ```

   `hasActiveFilters` derivation in `WorkspaceHeader`: `filters.q || filters.account !== "__all__" || filters.owner !== "__all__" || filters.statuses.length > 0` (plus assignee/due for tasks view).

   `activeFiltersCount` is the count of non-default filters across the same fields.

6. **`workspace.tsx`** passes the count + an `onClearFilters` callback to `WorkspaceHeader`:

   ```tsx
   <WorkspaceHeader
     filters={filters}
     onFilterChange={setFilters}
     accounts={accounts}
     team={team}
     poolTags={poolTags}
     projectCount={filtered.length}
     onClearFilters={handleClearFilters}
   />
   ```

   Note: `handleClearFilters` already exists in `workspace.tsx`. Surface it.

7. **Search keyboard shortcuts** (`/` to focus, Escape to clear) — existing `useEffect` in `WorkspaceHeader` lines 65–110. Keep as-is.

### Change 2 — `ProjectCard` rebuild

**File**: `src/industries/it-agency/features/project-board/components/project-card.tsx` (currently 103 lines, full rewrite).

**Reference**: `src/components/pipeline/LeadCard.tsx`.

**Field mapping** (LeadCard → ProjectCard):

| LeadCard field | ProjectCard equivalent | Source |
|---|---|---|
| `fullName` (header) | `project.name` | direct |
| `subtitle` (country) | n/a — drop subtitle row | — |
| Icon-square header (FileText) | `Folder` icon-square (same `bg-primary/10 text-primary` chrome) | hardcoded |
| Dropdown menu | View / Edit / (no Move-to since project status is the column) | `Link` to project detail + open ProjectForm (use a hook from parent? — see notes) |
| `Phone` row | n/a | — |
| `Email` row | n/a | — |
| `Created` row | n/a | — |
| `Assigned` row | n/a | — (account info moves into metadata grid below) |
| **New metadata rows for projects:** | | |
| n/a | `Account` row | `project.account_name` |
| n/a | `Contacts` row (only if > 0) | `project.contact_count` |
| n/a | `Billable` row (only if > 0) | `(hoursMap.get(project.id) ?? 0) / 60`, format `X.X hrs` |
| n/a | `Updated` row | `relativeTime(project.updated_at)` (use existing helper) |
| Time-in-stage urgency badge | Time-since-update urgency badge | `getDaysInStage` adapted to `getDaysSinceUpdate(project.updated_at)` — same red 7+ / amber 3+ / muted thresholds |
| Action chips (Phone / Email) | n/a — drop the action chip row | — |
| Assignee avatar (right side of footer) | Owner avatar (right side of footer, moved from card header) | `teamMap.get(project.owner_id)` |

**Layout** (mirror LeadCard's section structure):

```tsx
<div
  ref={setNodeRef}
  {...listeners}
  {...attributes}
  onClick={handleCardClick}
  className={`group rounded-xl border bg-card p-4 transition-all cursor-pointer ${
    isDragging
      ? "opacity-50 ring-2 ring-primary/20 scale-[1.02]"
      : "hover:border-muted-foreground/30"
  }`}
>
  {/* Section 1: Header — icon + name + dropdown */}
  <div className="flex items-start gap-3 mb-2">
    <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
      <Folder className="h-4 w-4 text-primary" />
    </div>
    <div className="flex-1 min-w-0">
      <Link
        href={`/time-tracking/projects/${project.id}`}
        className="text-sm font-semibold hover:text-primary transition-colors line-clamp-1 block text-[#0f0f10]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {project.name}
      </Link>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 -mr-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/time-tracking/projects/${project.id}`}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            View Details
          </Link>
        </DropdownMenuItem>
        {/* Edit / Log time — leave as future hooks */}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  {/* Divider */}
  <div className="border-t border-border/50 my-3" />

  {/* Section 2: Metadata key:value grid */}
  <div className="space-y-2 text-xs">
    <div className="flex items-center gap-2">
      <span className="text-[#787871] w-16 flex-shrink-0">Account</span>
      <span className="text-[#0f0f10] truncate">{project.account_name}</span>
    </div>
    {project.contact_count > 0 && (
      <div className="flex items-center gap-2">
        <span className="text-[#787871] w-16 flex-shrink-0">Contacts</span>
        <span className="text-[#0f0f10]">{project.contact_count}</span>
      </div>
    )}
    {billableHrs > 0 && (
      <div className="flex items-center gap-2">
        <span className="text-[#787871] w-16 flex-shrink-0">Billable</span>
        <span className="text-[#0f0f10]">{billableHrs.toFixed(1)} hrs</span>
      </div>
    )}
    <div className="flex items-center gap-2">
      <span className="text-[#787871] w-16 flex-shrink-0">Updated</span>
      <span className="text-[#0f0f10]">{relativeTime(project.updated_at)}</span>
    </div>
  </div>

  {/* Divider */}
  <div className="border-t border-border/50 my-3" />

  {/* Section 3: Footer — urgency badge + owner avatar */}
  <div className="flex items-center justify-between">
    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${urgencyStyles.bg} ${urgencyStyles.text}`}>
      <Clock className="h-3 w-3" />
      <span>{days === 0 ? "Today" : `${days}d`}</span>
    </div>
    {owner ? (
      <div
        title={owner.email}
        className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary"
      >
        {ownerInitials(owner.email)}
      </div>
    ) : (
      <div
        title="Unassigned"
        className="h-6 w-6 rounded-full bg-muted border border-border flex items-center justify-center"
      >
        <User className="h-3 w-3 text-muted-foreground" />
      </div>
    )}
  </div>
</div>
```

**Whole-card-clickable behavior** (Sadin's "let's make it link as well — clickable"):

```tsx
const router = useRouter();

function handleCardClick(e: React.MouseEvent) {
  // Drag listeners attached to the same div will pre-empt clicks via dnd-kit's
  // activationConstraint distance; clicks that survive are navigation intent.
  // Inner Link + dropdown buttons stopPropagation, so they short-circuit before this fires.
  router.push(`/time-tracking/projects/${project.id}`);
}
```

The card is **not** wrapped in `<Link>` because nested-link a11y warnings. Instead, the body has `onClick={handleCardClick}` and the name is also a `<Link>` for keyboard navigation (Tab + Enter). `useRouter()` from `next/navigation` for the programmatic push.

**Drag listeners** stay (`useDraggable` from `@dnd-kit/core`). The activation constraint `distance: 5` (`board-view.tsx:79`) means a small drag distance triggers drag mode, while a stationary click triggers `handleCardClick`. Don't add additional drag activation guards.

**Drop the `<Card>` wrapper from `@/components/ui/card`** — go with the raw `<div className="rounded-xl border bg-card p-4 …">` pattern to match LeadCard exactly. Trade-off: lose the auto Card styling, gain pixel-perfect parity.

**`isDragOverlay` prop** (existing) — when true, render the same card but without listeners/handler/onClick — used by `BoardView.tsx:185-201` (the `<DragOverlay>` content). The DragOverlay in BoardView currently renders a small inline `<Card>`; rebuild it to render `<ProjectCard isDragOverlay={true} … />` instead so the floating preview matches the new card. **Don't forget this** — it's a tiny but visible regression if missed.

### Change 3 — `ProjectColumn` width + footer

**File**: `src/industries/it-agency/features/project-board/components/project-column.tsx`.

**Changes**:

1. **Width**: `min-w-[220px] w-[220px]` → `min-w-80 w-80` (320px, matches PipelineColumn).
2. **Add column footer** after the droppable body, mirroring `PipelineColumn.tsx:89-101`:

   ```tsx
   {/* Column footer */}
   <div className="px-3 py-2 bg-card rounded-b-lg border border-t-0 border-gray-200 space-y-0.5">
     <div className="flex items-center justify-between text-xs">
       <span className="text-[#787871]">Total</span>
       <span className="font-medium text-[#0f0f10]">
         {projects.length} project{projects.length !== 1 ? "s" : ""}
       </span>
     </div>
     {projects.length > 0 && totalBillableHrs > 0 && (
       <div className="flex items-center justify-between text-xs">
         <span className="text-[#787871]">Billable</span>
         <span className="font-medium text-[#0f0f10]">{totalBillableHrs.toFixed(1)} hrs</span>
       </div>
     )}
   </div>
   ```

   - `totalBillableHrs` is the sum of `(hoursMap.get(p.id) ?? 0) / 60` across the column's projects. Compute it inline at the top of `ProjectColumn`:
     ```tsx
     const totalBillableHrs = projects.reduce((sum, p) => sum + (hoursMap.get(p.id) ?? 0) / 60, 0);
     ```
3. **Body `rounded-b-lg`** is no longer correct because the footer is now below — drop the body's `rounded-b-lg` since the footer takes over.
4. **`isOver` highlight** stays as-is from the first brief (`border-[#0f0f10] bg-[#0000170b]`).
5. **Body background** consideration: currently `bg-gray-50/40`. PipelineColumn uses `bg-muted/20`. Both look near-identical in practice. **Keep current** (`bg-gray-50/40`) unless it looks wrong in dev — the brief's first wave already shipped with it.

### Change 4 — `BoardView` (minor)

**File**: `src/industries/it-agency/features/project-board/components/views/board-view.tsx`.

- **Rebuild the `<DragOverlay>` content** (lines 185-201): replace the small inline `<Card>` with `<ProjectCard project={draggingProject} teamMap={teamMap} hoursMap={hoursMap} isDragOverlay={true} />` so the floating preview during drag matches the new card.
- **`isDragOverlay`** already exists as a prop on `ProjectCard` — keep it; just route drag-overlay rendering through it.
- Width of the DragOverlay wrapper: drop the `w-[220px]` since the new card is 320 — set to `w-80` or remove the wrapper width entirely and let ProjectCard's intrinsic size win.
- The column gap (`flex gap-4 overflow-x-auto pb-4`) stays the same — matches Pipeline's `gap-4`.

---

## Files to touch

| File | Change |
|---|---|
| `src/industries/it-agency/features/project-board/pages/workspace.tsx` | Pass `projectCount={filtered.length}` and `onClearFilters={handleClearFilters}` to `WorkspaceHeader`. |
| `src/industries/it-agency/features/project-board/components/workspace-header.tsx` | Add `projectCount` + `onClearFilters` props. Restructure into title row + bordered toolbar card (count chip + search + spacer top row, divider, filter row with active-filters indicator). Drop LayoutGrid icon from title. Compute `hasActiveFilters` + `activeFiltersCount`. Move Show Cancelled checkbox into the filter row. |
| `src/industries/it-agency/features/project-board/components/project-card.tsx` | Full rewrite mirroring `LeadCard`: 3-section structure (header icon-square + name link + dropdown menu / divider / key:value metadata grid / divider / footer urgency badge + owner avatar). Whole-card-clickable via `useRouter().push`; inner Link + dropdown buttons stopPropagation. Drop the `<Card>` wrapper. Keep `isDragOverlay` prop for the DragOverlay path. Drop the building-icon + account inline row (account moves into metadata grid). Move owner avatar from header to footer. |
| `src/industries/it-agency/features/project-board/components/project-column.tsx` | Widen `220→320` (use `min-w-80 w-80`). Add column footer with Total + Billable. Drop body's `rounded-b-lg` (footer takes over). Inline `totalBillableHrs` derivation. |
| `src/industries/it-agency/features/project-board/components/views/board-view.tsx` | Rewire DragOverlay to render `<ProjectCard … isDragOverlay={true} />` instead of an inline `<Card>`. Update wrapper width 220→320. |

**Total: 5 files. Likely 350-450 LOC net change (mostly the card rewrite).** UI-only — no DB, no API, no new routes.

---

## Patterns to reuse

- **PipelineBoard toolbar shape**: `src/components/pipeline/PipelineBoard.tsx:552-720`. The exact pattern is `<div className="shrink-0 bg-card rounded-lg border">` wrapping a top row (`flex items-center gap-3 p-3`) + a divider (`h-px bg-border`) + a filter row (`flex flex-wrap items-center gap-1.5 px-3 py-2`). Copy verbatim.
- **LeadCard structure**: `src/components/pipeline/LeadCard.tsx`. The 3-section layout (`mb-2` header, `my-3` dividers, `space-y-2 text-xs` metadata grid, footer) is the template. Adapt for project fields.
- **Urgency styles helper**: copy `getUrgencyStyles(days)` from `LeadCard.tsx:47-51` into `project-card.tsx`. Don't try to share it — they're 5 lines each and tightly bound to their use site.
- **Format helpers in ProjectCard**: keep the existing `relativeTime` + `ownerInitials` helpers from the current `project-card.tsx`. They're already correct for project semantics.
- **Active filters indicator**: copy from `PipelineBoard.tsx:705-718`. Adapt the active-filter derivation to project fields.

---

## Design tokens (already established, don't reinvent)

- Primary text: `#0f0f10` (names, labels). For tokens-based colors, `text-foreground` also works (`--foreground: #171717`).
- Secondary text: `#787871` (data values, meta).
- Card chrome: `bg-card` (`#ffffff`) with `border border-border` (`#e5e7eb`).
- Hover border: `hover:border-muted-foreground/30`.
- Drag-state ring: `ring-2 ring-primary/20`.
- Urgency colors (from LeadCard, mirror exactly):
  - ≥7 days: `bg-red-100 text-red-700`
  - ≥3 days: `bg-amber-100 text-amber-700`
  - <3 days: `bg-muted text-muted-foreground`
- Icon-square: `h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center` with icon `h-4 w-4 text-primary`.
- Owner avatar (assigned): `h-6 w-6 rounded-full bg-primary/10 border border-primary/20` with `text-primary` initials.
- Owner avatar (unassigned): `h-6 w-6 rounded-full bg-muted border border-border` with `text-muted-foreground` User icon.

---

## Verification

Before merging:

- [ ] `npm run build` clean locally.
- [ ] `npx eslint --max-warnings 50 .` clean locally (CI hard gate).
- [ ] `/projects` Board view:
  - Title row: plain "Projects" text (no LayoutGrid icon prefix) + view-toggle Tabs on right.
  - Toolbar card with rounded corners and border, containing: count chip ("N Projects") + search bar + spacer in the top row, internal divider, filter row with Account / Owner / Status / Show Cancelled + active-filters indicator (when any filter active).
  - Search bar is `h-9 w-60`, no longer the cramped `h-7 w-44`.
  - Active-filters Badge appears with the filter count + Clear button — exactly matches `/pipeline`.
- [ ] Kanban columns are 320px wide. Five status columns + cancelled (when toggled) fit horizontally with `overflow-x-auto` showing the scrollbar when needed.
- [ ] Each column has the bordered header (colored dot + name + count chip) at the top, the droppable body in the middle, and the new footer at the bottom with `Total: N projects` + (when applicable) `Billable: X.X hrs`.
- [ ] Project cards render with:
  - Icon-square header (Folder icon, primary-tinted bg) on the left.
  - Project name as a `<Link>` to `/time-tracking/projects/<id>`.
  - 3-dot dropdown menu on the right (appears on hover).
  - Internal divider, then metadata grid: `Account / Contacts / Billable / Updated` (rows hidden when zero/null where conditional).
  - Internal divider, then footer with urgency badge on the left (Today / Xd) and owner avatar on the right.
- [ ] Whole card is clickable — clicking anywhere in card body (except the name link or dropdown trigger) routes to `/time-tracking/projects/<id>`. Dragging works as before (5px activation distance).
- [ ] DragOverlay shows the new card design while dragging (not the old slim Card).
- [ ] `/projects` Table view: unchanged.
- [ ] `/projects` Tasks view: unchanged.
- [ ] `/projects` Members view: unchanged.
- [ ] All 6 code-review checklist items N/A — UI-only, no DB / no API / no new page / no Radix Select / no embed / no mutations.
- [ ] Drag a project between columns: optimistic update + TOCTOU precondition still works.

---

## Sonnet handoff prompt

Paste the block below to a fresh Sonnet session.

```
You're implementing a UI-only design-parity change on a feature branch. Read /Users/sadinshrestha/Projects/edgeXcrm/docs/PROJECTS-PIPELINE-PARITY-BRIEF.md end-to-end before touching any code — it has the full scope, the file list, the exact patterns to mirror from existing /pipeline code, and the verification checklist.

Workflow:
1. From the repo root, fetch latest stage and branch off it:
   git fetch origin && git checkout -b chore/projects-pipeline-parity origin/stage
2. Implement the 5 file changes per the brief:
   - workspace.tsx — pass projectCount + onClearFilters to WorkspaceHeader.
   - workspace-header.tsx — restructure into Pipeline's toolbar shape (title row, then bordered toolbar card with count+search top row, divider, filter row with active-filters indicator).
   - project-card.tsx — full rewrite mirroring LeadCard (3-section structure with dividers; whole-card-clickable via useRouter; inner name Link + dropdown stopPropagation; owner avatar moves to footer).
   - project-column.tsx — widen 220→320, add Total/Billable footer.
   - board-view.tsx — rewire DragOverlay through <ProjectCard isDragOverlay={true} />.
3. Verify locally before pushing:
   - npm run build  (clean)
   - npx eslint --max-warnings 50 .  (clean — this is the CI hard gate, local build does NOT run ESLint)
4. Self-check against the verification checklist at the bottom of the brief.
5. Commit with a clear message and push the branch. Don't merge; Opus reviews and squash-merges to stage.

Important constraints from the brief:
- Same data, restructured layout. Do NOT add or remove project fields. The card displays exactly: name, account, contacts (when >0), billable hrs (when >0), updated, owner.
- Do NOT reuse LeadCard directly — it's PipelineLead-shaped. Rebuild ProjectCard to MATCH the pattern.
- Do NOT add a "+ New Project" button to the toolbar — ProjectForm requires an accountId; out of scope for this brief.
- Do NOT add Sort/Export buttons — out of scope.
- Do NOT touch Tasks view, Members view, Table view, Priority chips, Task status chips, or drag-drop logic.
- DO move the owner avatar from the card header to the card footer (LeadCard pattern).
- DO drop the LayoutGrid icon from the title.
- DO rewire the DragOverlay (board-view.tsx) — easy to miss; it's a visible regression if forgotten.
- DO use design-pass tokens (#0f0f10 primary text, #787871 secondary, etc.) where applicable; LeadCard uses bg-card / text-foreground / text-muted-foreground tokens which are already pointed at the same values via globals.css. Either approach works — just be consistent.
- DO check that whole-card click navigation works without breaking drag (5px activation distance handles this; don't add extra guards).

If anything in the brief is ambiguous or you find a real issue with the approach, surface it in the handoff back to Opus rather than guessing.
```

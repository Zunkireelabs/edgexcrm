# BRIEF: Kanban-view Filters parity with List view (Leads page)

**For:** Sonnet executor · **Reviewer:** Opus · **Industry:** education_consultancy (universal component, gate edu-only bits)
**Do NOT open a PR.** Stop after `npm run build` is clean and report the diff for Opus review.

---

## Problem

On the Leads page (`/leads?list=<slug>`), the **List view** and **Kanban view** expose different Filter dropdowns.

| Filter | List view (`LeadsTable`) | Kanban view (`PipelineBoard`) |
|---|---|---|
| Source | ✅ "Source" (multi, counts) | ⚠️ "All Sources" (single, no counts) |
| Assigned To | ✅ "Assigned To" (multi, counts, Unassigned) | ⚠️ "All Counselors" (single) |
| Collaborators | ✅ "Collaborators" (multi) | ❌ missing |
| Tag (edu) | ✅ "Tag" | ❌ missing |
| Industry (it_agency) | ✅ "Industry" | ✅ present |
| Date created | ✅ "Date created" | ⚠️ "Any time" (same options, diff label) |
| Status | ✅ "Status" | ❌ missing |
| Form | ✅ "Form" (when >1 form) | ❌ missing |

**Goal:** make the Kanban Filters dropdown match the List view — same options, same labels, same multi-select behavior, same gating. Do NOT touch Edit-columns or the List/Kanban toggle buttons.

The relevant Kanban path is: `page.tsx` → `ListKanbanView` → `PipelineBoard`. (There is a second `PipelineBoard` consumer at `pipeline/page.tsx` — **do not change its behavior**; make the new props optional so it keeps compiling untouched.)

---

## Good news: no new fetches needed

The Leads page **already computes** both missing data maps for the List view — they just aren't passed to the Kanban path:

- `src/app/(main)/(dashboard)/leads/page.tsx:194` — `leadCollaboratorsMap`
- `src/app/(main)/(dashboard)/leads/page.tsx:203` — `formMap`

Both are already passed to `<LeadsTable>` (lines 313, 317). We just thread the same two into `<ListKanbanView>` → `<PipelineBoard>`. Everything else (sources, counselors, tags, status, created) is derivable client-side from the `leads` array `PipelineBoard` already holds.

---

## Files to edit (4)

### 1. `src/app/(main)/(dashboard)/leads/page.tsx` (~line 256)
Pass the two existing maps to `<ListKanbanView>`:
```tsx
<ListKanbanView
  listSlug={activeList.slug}
  ...
  leadCollaborators={leadCollaboratorsMap}
  formMap={formMap}
/>
```

### 2. `src/components/dashboard/leads/list-kanban-view.tsx`
- Add to `ListKanbanViewProps`:
  ```ts
  leadCollaborators?: Record<string, string[]>;
  formMap?: Record<string, string>;
  ```
- Destructure them (default `{}`) and forward to `<PipelineBoard>`.

### 3. `src/components/pipeline/PipelineBoard.tsx` — the main work
Add to `PipelineBoardProps` (both optional, default `{}`):
```ts
leadCollaborators?: Record<string, string[]>;
formMap?: Record<string, string>;
```

Then, mirroring `LeadsTable`'s `filterDefs` (`src/components/dashboard/leads-table.tsx:1327-1509`) and its predicates:

**a. Filter state.** Change to match List's multi/single split:
- `sourceFilter` → `string[]` (multi)
- `counselorFilter` → `string[]` (multi; supports `"unassigned"`)
- add `collaboratorFilter: string[]` (multi)
- add `tagFilter: string` (single, default `"all"`)
- add `statusFilter: string` (single, default `"all"`)
- add `formFilter: string` (single, default `"all"`)
- keep `createdFilter` / `industryFilter` as-is (single)

**b. Derive option lists + counts** client-side from `leads` (mirror LeadsTable's `sourceCounts`/`counselorCounts`/`collaboratorCounts` useMemos, `leads-table.tsx:430-535`):
- counselors from `teamMembersData` (has `user_id`/`email`/`name`/`role`); counts from `l.assigned_to`; include `unassigned` count.
- collaborators from `Object.values(leadCollaborators)`; gate out members whose `teamMembersData.role` is `owner`/`admin` (build a role map); counts from `leadCollaborators`.
- tags: education only.
- status options: `[{value:"all",label:"All Status"}, ...stages.map(s => ({value: s.slug, label: s.name}))]` — the board already receives `stages` (the list's pipeline stages). Mirror `statusFilterOptions` (`leads-table.tsx:692`).
- form: `Object.entries(formMap)`; only show filter when `> 1` entry (`hasMultipleForms`).

**c. `filterDefs`** (`PipelineBoard.tsx:565`): rebuild so labels/icons/`multiple` flags/count-suffixed labels match `LeadsTable`'s exactly. Keep the same gating:
- Source: `sources.length > 0` · multiple
- Assigned To: `isAdmin` · multiple (label "Assigned To", icon `Users2`)
- Collaborators: `isAdmin && Object.keys(leadCollaborators).length > 0` · multiple · `UserPlus` icon
- Tag: `industryId === "education_consultancy"` · single (options All Tags / Student)
- Industry: `industryId === "it_agency"` · single (keep existing)
- Date created: always · single · **relabel "Any time" → "Date created"**
- Status: always · single
- Form: `hasMultipleForms` · single

**d. `filteredColumns` predicate** (`PipelineBoard.tsx:288-333`): update matches — `matchesSource`/`matchesCounselor` become array `.includes` (empty array = all); add `matchesCollaborator`, `matchesTag`, `matchesStatus`, `matchesForm`. **Copy the exact predicates from `LeadsTable`** so behavior is identical:
- tag → mirror List's tag predicate (Student = `l.tags?.[0] === "student"` per its badge/toggle convention — verify against `leads-table.tsx`)
- status → `statusFilter === "all" || l.status === statusFilter`
- form → `formFilter === "all" || l.form_config_id === formFilter`
- collaborator → `collaboratorFilter.length === 0 || (leadCollaborators[l.id] ?? []).some(u => collaboratorFilter.includes(u))`

**e.** Update `clearFilters` (`:335`) and `activeFiltersCount` (`:343`) to include the new filters.

### 4. `pipeline/page.tsx` consumer — no change needed
New props are optional; that board just won't show Collaborators/Form (no maps passed). Confirm it still builds.

---

## Notes / decisions
- **Status filter looks redundant in Kanban** (columns already = stages). Included for strict parity per Anish's request; predicate matches List (`l.status`). Leave in unless Opus says drop.
- **`isTeamScoped`**: List gates Assigned To/Collaborators on `isAdmin || isTeamScoped`. `PipelineBoard` has no `isTeamScoped` — keep its existing `isAdmin` gate. Acceptable parity; flag if you think it matters.
- Do not alter drag/drop, sort, export, Add Lead, or the toggle/manage-stages header.

## Verify (required before reporting)
```bash
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
npm run build
```
Manual (dev-lead-crm, Admizz education tenant): open a list Kanban → Filters shows Source, Assigned To, Collaborators, Tag, Date created, Status, Form; each filters cards live; List view unchanged. Then report the full diff — **no PR**.

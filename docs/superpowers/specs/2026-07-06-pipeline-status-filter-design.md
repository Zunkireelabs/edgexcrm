# Pipeline: Per-Column Status Filter + Branch-Scope Fix

**Date:** 2026-07-06  
**Scope:** education_consultancy (primary), universal pipeline view

---

## Problem

Two gaps in the pipeline board:

1. **Missing status filter** — users cannot filter leads within a Stage column by their current status. All statuses are always shown together.
2. **Branch-manager visibility gap** — `getLeadsForPipeline()` does not include leads shared via `lead_branches` (leads that originated in the manager's branch but were sent to another branch). `getLeads()` handles this correctly; the pipeline query does not.

---

## Visibility Rules (confirmed by Sadin)

| Role | Sees |
|------|------|
| Admin / Owner | All leads across all branches |
| Branch Manager | Own branch members' leads + leads sent from their branch to another branch (via `lead_branches`) + collaborated leads |
| All others | Own assigned leads + collaborated leads |

---

## Design

### Fix 1 — `getLeadsForPipeline()` branch-scope gap

**File:** `src/lib/supabase/queries.ts`

In the `branchId` branch of `getLeadsForPipeline()`, add a parallel `leadIdsForBranch()` call alongside the existing `branchMemberIds()` call. Widen the query OR condition to include those shared lead IDs — exactly mirroring the pattern already used in `getLeads()`.

**Before (current):**
```ts
const memberIds = await branchMemberIds(svc, tenantId, options.branchId);
query = query.or(`assigned_to.in.(${memberIds.join(",")}),and(assigned_to.is.null,branch_id.eq.${options.branchId})`);
```

**After:**
```ts
const [memberIds, sharedIds] = await Promise.all([
  branchMemberIds(svc, tenantId, options.branchId),
  leadIdsForBranch(svc, tenantId, options.branchId).then((ids) => ids.slice(0, 300)),
]);
// Build OR: assigned to branch member, OR unassigned in branch, OR shared via lead_branches
const parts: string[] = [];
if (memberIds.length > 0) parts.push(`assigned_to.in.(${memberIds.join(",")})`);
parts.push(`and(assigned_to.is.null,branch_id.eq.${options.branchId})`);
if (sharedIds.length > 0) parts.push(`id.in.(${sharedIds.join(",")})`);
query = query.or(parts.join(","));
```

Import `leadIdsForBranch` — already exists in the same file.

---

### Fix 2 — Per-column status filter

#### State (`PipelineBoard.tsx`)

Add a map of selected status per column:

```ts
const [columnStatusFilters, setColumnStatusFilters] = useState<Record<string, string>>({});
```

Helper:
```ts
const setColumnStatus = (stageId: string, slug: string) =>
  setColumnStatusFilters((prev) => ({ ...prev, [stageId]: slug }));
```

#### Status options per column

Derive from already-loaded `stages` (pipeline stages). Each stage column has a `pipeline_id`; the pipeline stages (statuses) for that column are those with a matching `pipeline_id`:

```ts
// stages: PipelineStage[] already in scope (prop from page.tsx)
const statusesByColumn = useMemo(() => {
  const map: Record<string, PipelineStage[]> = {};
  for (const stage of stages) {
    if (!map[stage.pipeline_id]) map[stage.pipeline_id] = [];
    map[stage.pipeline_id].push(stage);
  }
  return map; // keyed by pipeline_id
}, [stages]);
```

Each column (lead_list stage) passes its `pipeline_id` to look up its valid statuses.

#### Filtering (`filteredColumns` memo)

Add per-column status check inside the existing filter loop:

```ts
const activeStatus = columnStatusFilters[col.id]; // col.id = stage/list id
const matchesStatus = !activeStatus || activeStatus === "all" || lead.status === activeStatus;
```

All existing filters (search, counselor, source, date) still apply.

#### UI — `PipelineColumn.tsx`

In the column header, add a `Filter` icon (lucide-react) next to the lead count:

- **No active filter:** `Filter` icon, muted color, no badge
- **Active filter:** `Filter` icon, primary color, small dot indicator on icon

Click opens a `Popover` (shadcn) with a simple list:
- "All" option at top (clears filter)
- One item per status for that column (slug as value, display name as label)
- Active item shows a checkmark

Props added to `PipelineColumn`:
```ts
statuses: PipelineStage[]          // valid statuses for this column
selectedStatus: string | undefined  // current selection
onStatusChange: (slug: string) => void
```

#### No change to global "Clear filters"

The per-column status filters are independent of the global filter bar. Clearing global filters does not reset column status filters. Each column's filter resets only when the user selects "All" in that column's dropdown.

---

## Implementation Note

Before coding, confirm in `PipelineBoard.tsx` whether columns are keyed by `list_id` (lead_lists / Stages) or `stage_id` (pipeline_stages / Statuses). The spec assumes columns = lead_lists (`list_id`), with pipeline_stages (`stage_id`) as the statuses within each column. If the board uses a different key, adjust the state map and filter lookup accordingly.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/supabase/queries.ts` | Add `leadIdsForBranch` to branch-scope query in `getLeadsForPipeline()` |
| `src/components/pipeline/PipelineBoard.tsx` | Add `columnStatusFilters` state, `statusesByColumn` memo, per-column status check in `filteredColumns` |
| `src/components/pipeline/PipelineColumn.tsx` | Add filter icon + popover UI, accept `statuses` / `selectedStatus` / `onStatusChange` props |

---

## Verification

1. **Branch-scope fix:** Log in as a branch manager → pipeline board shows leads assigned to their branch members AND leads in `lead_branches` for their branch
2. **Admin/Owner:** Sees all leads — unchanged
3. **Own-scope user:** Sees own + collaborated leads — unchanged
4. **Status filter:** Click filter icon on "Qualified" column → dropdown shows Qualified's statuses only → selecting one filters that column's cards → other columns unaffected
5. **Multiple columns:** Set different status filters on two columns simultaneously — each column filters independently
6. **Clear:** Select "All" in a column → all leads in that column return
7. **Drag-and-drop:** Works correctly while status filters are active
8. **Real-time:** Supabase subscription updates respect active column filters

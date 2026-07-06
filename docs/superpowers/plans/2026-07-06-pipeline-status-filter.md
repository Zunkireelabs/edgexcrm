# Pipeline: Per-Column Status Filter + Branch-Scope Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-column status filter (filter icon in each Stage column header) to the education_consultancy pipeline view, and fix the branch-scope gap in `getLeadsForPipeline()` so branch managers see shared leads on the standard pipeline board.

**Architecture:** The education_consultancy pipeline renders `ListFunnelBoard` (read-only Kanban keyed by `lead_lists`). Converting it to a client component enables per-column `useState` for filter selection. Available statuses are derived from the leads already fetched — no extra DB queries. The branch-scope fix is a parallel call addition in `getLeadsForPipeline()` in `queries.ts`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, shadcn/ui (Popover), lucide-react (Filter icon), Tailwind CSS v4

## Global Constraints

- Education_consultancy only for the funnel board feature
- No new API routes or DB queries for the status filter — derive from existing data
- `getLeadsForPipeline()` branch fix must mirror the exact pattern used in `getLeads()` (lines 109-110 in queries.ts)
- No drag-and-drop on `ListFunnelBoard` — read-only by design
- Follow existing shadcn Popover + lucide icon patterns from `PipelineBoard.tsx`
- Run `npm run build` to verify compile after each task (OOM on tsc is pre-existing, ignore it)

---

### Task 1: Fix `getLeadsForPipeline()` branch-scope gap

**Files:**
- Modify: `src/lib/supabase/queries.ts:474-484`

**Interfaces:**
- Consumes: `branchMemberIds`, `leadIdsForBranch` (already imported at line 5)
- Produces: branch-scoped `getLeadsForPipeline()` that includes `lead_branches` shared leads

- [ ] **Step 1: Open the file and locate the branch-scope block**

Open `src/lib/supabase/queries.ts`. Find the `else if (options?.branchId)` block around line 474. It currently looks like:

```ts
} else if (options?.branchId) {
  // Service client: tenant_users RLS hides other users' rows from the RLS client.
  const svc = await createServiceClient();
  const memberIds = await branchMemberIds(svc, tenantId, options.branchId);
  // Include unassigned leads in this branch too — see getLeads() above for why.
  if (memberIds.length > 0) {
    query = query.or(`assigned_to.in.(${memberIds.join(",")}),and(assigned_to.is.null,branch_id.eq.${options.branchId})`);
  } else {
    query = query.is("assigned_to", null).eq("branch_id", options.branchId);
  }
}
```

- [ ] **Step 2: Replace the branch-scope block with the fix**

Replace that block with:

```ts
} else if (options?.branchId) {
  // Service client: tenant_users RLS hides other users' rows from the RLS client.
  const svc = await createServiceClient();
  const [memberIds, sharedIds] = await Promise.all([
    branchMemberIds(svc, tenantId, options.branchId),
    leadIdsForBranch(svc, tenantId, options.branchId).then((ids) => ids.slice(0, 300)),
  ]);
  // Include: leads assigned to branch members, unassigned leads in branch,
  // and leads shared into this branch via lead_branches (sent from this branch to another).
  const parts: string[] = [];
  if (memberIds.length > 0) parts.push(`assigned_to.in.(${memberIds.join(",")})`);
  parts.push(`and(assigned_to.is.null,branch_id.eq.${options.branchId})`);
  if (sharedIds.length > 0) parts.push(`id.in.(${sharedIds.join(",")})`);
  if (parts.length > 0) {
    query = query.or(parts.join(","));
  }
}
```

- [ ] **Step 3: Verify build compiles**

```bash
npm run build 2>&1 | grep -E "Compiled|error TS|Failed"
```

Expected: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/queries.ts
git commit -m "fix(pipeline): include lead_branches shared leads for branch-scope in getLeadsForPipeline"
```

---

### Task 2: Per-column status filter on `ListFunnelBoard`

**Files:**
- Modify: `src/components/pipeline/ListFunnelBoard.tsx`

**Interfaces:**
- Consumes: `lists: LeadList[]`, `leadsByListId: Record<string, Lead[]>`, `memberNames: Record<string, string>` (existing props — unchanged)
- Produces: same props interface, adds internal client state for per-column status filter

- [ ] **Step 1: Add `"use client"` and new imports**

Replace the top of `src/components/pipeline/ListFunnelBoard.tsx` (lines 1-3):

```tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Mail, Phone, Clock, Filter } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Lead, LeadList } from "@/types/database";
```

- [ ] **Step 2: Add per-column filter state and derived statuses to `ListFunnelBoard`**

Inside `ListFunnelBoard`, before the `return`, add:

```tsx
const [columnStatusFilters, setColumnStatusFilters] = useState<Record<string, string>>({});

// Derive available statuses per column from the leads already fetched.
// Each list may have different statuses; build from actual lead.status values.
const statusesPerList = useMemo(() => {
  const map: Record<string, string[]> = {};
  for (const list of lists) {
    const listLeads = leadsByListId[list.id] ?? [];
    const unique = [...new Set(listLeads.map((l) => l.status).filter((s): s is string => Boolean(s)))].sort();
    map[list.id] = unique;
  }
  return map;
}, [lists, leadsByListId]);
```

- [ ] **Step 3: Apply per-column filter when rendering leads**

Inside the `lists.map((list) => { ... })` block, replace:

```tsx
const leads = leadsByListId[list.id] ?? [];
```

With:

```tsx
const allLeads = leadsByListId[list.id] ?? [];
const activeStatus = columnStatusFilters[list.id];
const leads = activeStatus && activeStatus !== "all"
  ? allLeads.filter((l) => l.status === activeStatus)
  : allLeads;
const availableStatuses = statusesPerList[list.id] ?? [];
```

- [ ] **Step 4: Add filter icon + popover to column header**

Replace the column header section:

```tsx
<div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0">
  <div
    className="h-3 w-3 rounded-full shrink-0"
    style={{ backgroundColor: list.color ?? "#94a3b8" }}
  />
  <h3 className="text-sm font-semibold truncate flex-1">{list.name}</h3>
  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 font-medium">
    {leads.length}
  </span>
</div>
```

With:

```tsx
<div className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-t-lg border border-b-0">
  <div
    className="h-3 w-3 rounded-full shrink-0"
    style={{ backgroundColor: list.color ?? "#94a3b8" }}
  />
  <h3 className="text-sm font-semibold truncate flex-1">{list.name}</h3>
  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 font-medium">
    {leads.length}
  </span>
  {availableStatuses.length > 0 && (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`shrink-0 p-1 rounded transition-colors hover:bg-muted ${
            activeStatus && activeStatus !== "all"
              ? "text-primary"
              : "text-muted-foreground"
          }`}
          title="Filter by status"
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <button
          type="button"
          onClick={() => setColumnStatusFilters((prev) => ({ ...prev, [list.id]: "all" }))}
          className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between ${
            !activeStatus || activeStatus === "all" ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          All statuses
          {(!activeStatus || activeStatus === "all") && (
            <span className="text-primary text-[10px]">✓</span>
          )}
        </button>
        {availableStatuses.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => setColumnStatusFilters((prev) => ({ ...prev, [list.id]: slug }))}
            className={`w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between capitalize ${
              activeStatus === slug ? "font-medium text-foreground" : "text-muted-foreground"
            }`}
          >
            {slug}
            {activeStatus === slug && (
              <span className="text-primary text-[10px]">✓</span>
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )}
</div>
```

- [ ] **Step 5: Verify build compiles**

```bash
npm run build 2>&1 | grep -E "Compiled|error TS|Failed"
```

Expected: `✓ Compiled successfully`

- [ ] **Step 6: Manual smoke test**

1. Run `npm run dev` and open `http://localhost:3000/pipeline`
2. Log in as `admin@zunkireelabs.com` / `edgexdev123`
3. Verify: each Stage column header shows a `Filter` icon only when leads with different statuses exist
4. Click the filter icon on a column with multiple statuses → popover opens listing available statuses
5. Select a status → column shows only leads with that status; other columns unaffected
6. Select "All statuses" → all leads return
7. Set filters on two different columns simultaneously → each filters independently

- [ ] **Step 7: Commit**

```bash
git add src/components/pipeline/ListFunnelBoard.tsx
git commit -m "feat(pipeline): add per-column status filter to list funnel board"
```

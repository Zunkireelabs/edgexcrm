# BRIEF — Dashboard nav loading skeletons (`loading.tsx`)

**Owner session:** Sonnet (executor). **Reviewer:** Opus (review post-hoc — do NOT self-merge, do NOT push to stage, STOP at the review gate and produce a report).
**Skill:** `/frontend-dev`.
**Branch:** create `feature/dashboard-loading-skeletons` off `stage`.
**Scope:** Add Next.js App Router `loading.tsx` files only. **No changes to any `page.tsx`, query, or data logic.**

---

## Why

Every dashboard route is an `async` server component that runs `getCurrentUserTenant()` + a large `Promise.all([...])` of queries **before returning any JSX**, and the app has **zero `loading.tsx` files**. So clicking a nav item blocks on the full server render with no visual feedback — the UI looks frozen for 1–3s. (Confirmed: `find src/app -name loading.tsx` → 0 results.)

A `loading.tsx` creates a Suspense boundary: Next instantly swaps to a skeleton and streams the real page in behind it. This fixes the **perceived** slowness immediately. It does NOT make queries faster (that's separate Layer-2 work: pagination / SQL aggregates / `dynamic()` — not in this brief).

## How it behaves (important context)

- `src/app/(main)/(dashboard)/layout.tsx` renders `DashboardShell` (sidebar + header) and awaits its own data **once** per session. Nav between dashboard routes re-renders only the **page**, not the layout.
- A `loading.tsx` at `src/app/(main)/(dashboard)/loading.tsx` therefore shows the skeleton in the **content area** while the shell stays painted → exactly the instant-nav feel we want.
- A `loading.tsx` placed inside a specific route folder (e.g. `leads/loading.tsx`) **overrides** the group-level one for that route. So: one baseline + a few tailored.

## Reuse

- Use the existing `@/components/ui/skeleton` (`Skeleton` — `animate-pulse rounded-md bg-accent`). Do not create a new primitive.
- Match each skeleton's outer container padding/spacing to what the real page uses (open the corresponding `page.tsx` / its root component and copy the wrapper classes, e.g. `p-4 md:p-6 space-y-4`) so the skeleton doesn't jump on swap.
- These are **Server Components** (no `"use client"` needed — they're static markup).

---

## Tasks

### 1. Baseline (covers all ~40 routes) — `src/app/(main)/(dashboard)/loading.tsx`

Generic content skeleton: a title bar + a couple of toolbar blocks + a grid/list of placeholder rows. Example shape (adjust spacing to match the shell's content padding):

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* page title + action */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-9 w-32" />
      </div>
      {/* toolbar */}
      <Skeleton className="h-10 w-full max-w-md" />
      {/* content rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
```

### 2. Tailored skeletons for the 3 distinct heavy pages

Each overrides the baseline for its route. Match the real page's layout so the swap is seamless.

- **`leads/loading.tsx`** — table shape: a filter/toolbar row, a header row, then ~10 full-width row skeletons. (Open `leads/page.tsx` → `LeadsTable` to mirror the container.)
- **`pipeline/loading.tsx`** — board shape: a selector row, then a horizontal row of ~4 columns, each with a column header + 3–4 stacked card skeletons. (Mirror `PipelineBoard` columns.)
- **`dashboard/loading.tsx`** — a row of 4 stat-card skeletons (grid) + 2–3 larger chart-block skeletons below. (Mirror `StatsCards` + the charts grid.)

### 3. (Optional, only if quick) reuse for 3 more

`home/loading.tsx`, `contacts/loading.tsx`, `leads-organise/loading.tsx`. `contacts` is a table → reuse the leads shape. If these don't have an obviously distinct layout, **skip them** — the baseline already covers them. Do NOT spend time hand-crafting all 40 routes; baseline + the 3 tailored is the goal.

---

## Verification (Sonnet runs, then STOPS)

1. `npx eslint --max-warnings 50` — clean.
2. `npx tsc --noEmit` — clean.
3. `npm run build` — clean (confirm the new routes compile; loading.tsx is part of the route tree).
4. **Hands-on `npm run dev`:** log in (`admin@zunkireelabs.com` / `edgexdev123` on local→dev DB), click between several nav items (Leads, Pipeline, Dashboard/Insights, Home, Contacts). Confirm: clicking a nav **instantly** shows a skeleton in the content area with the sidebar/header staying put, then the real page streams in. Note any route where the skeleton looks visually wrong (big layout jump) — but do not over-tune.
5. Confirm `git diff --name-only stage` shows **only** new `loading.tsx` files — no `page.tsx` or query files touched.

## STOP — review gate

Do NOT push to `stage`, do NOT open a merge, do NOT deploy. Commit to `feature/dashboard-loading-skeletons` and report:
- List of `loading.tsx` files added.
- Verification results (gates + what you saw clicking through dev, ideally a note per route).
- Confirmation that only `loading.tsx` files changed (paste `git diff --name-only stage`).

Opus will review the diff, re-run gates, and (with Sadin's OK) drive the stage merge — which now deploys fast via GHCR.

---

## Not in this brief (Layer 2 — later)

Actual query speedups: server-side pagination beyond #33, SQL `count`/aggregate for dashboard stats (stop loading all leads to count), `dynamic()` lazy-loading for recharts (dashboard) and @dnd-kit (pipeline). Tracked in [[project_perf_audit]]; separate briefs.

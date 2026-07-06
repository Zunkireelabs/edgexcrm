# BRIEF — Leads Organise PHASE 3 (merge-gating: keep staging "actual") — for Sonnet

> **Role:** Executor. ONE small change on the EXISTING branch `feature/leads-organise` (latest commit
> `1406217`). Build, run gates, commit, then **STOP and report**. Do NOT push, PR, merge, or touch prod.
> No migrations, no DB changes. **Sadin verifies the UI himself** — build + lint are your gates.

## Intent
Staging lists (Migration List, and any future `is_staging` list under Leads Organise) must stay
**"actual"** — no deduplication merges there. **Merges happen only in the main pipeline.** Today the
Merge action appears in every LeadsTable view; we need it **hidden in staging views**, unchanged in the
main pipeline.

## The change (one prop + two guards)
1. **`src/components/dashboard/leads-table.tsx`**
   - Add `isStagingView?: boolean;` (default `false`) to `LeadsTableProps` (the interface ~lines 82-101)
     and destructure it with a `= false` default in the component.
   - The Merge button is rendered in the bulk action bar at ~**line 1097**:
     `{isAdmin && selectedCount === 2 && ( … Merge button … )}` → change the guard to
     `{isAdmin && !isStagingView && selectedCount === 2 && ( … )}`.
   - The merge dialog render guard at ~**line 1477** (`isAdmin && mergeDialogOpen && selectedCount === 2`)
     → add `!isStagingView` there too (belt-and-suspenders).
2. **`src/app/(main)/(dashboard)/leads-organise/[slug]/page.tsx`**
   - This page only ever renders a staging list, so pass the flag on the `<LeadsTable … />`:
     add `isStagingView` (i.e. `isStagingView={true}`).
   - **Do NOT** touch `src/app/(main)/(dashboard)/leads/page.tsx` — leaving the prop unset keeps Merge
     enabled in the main pipeline (the desired behavior).

That's the whole change. No other LeadsTable call sites render the Merge button, so this one prop hides
it across all current and future staging views.

## Gates / report
- `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Do NOT block on UI login — Sadin confirms: Merge button absent on `/leads-organise/[slug]`, present on
  `/leads` (main) when exactly 2 leads are selected as admin.
- Commit on `feature/leads-organise` with a clear message, then STOP and report (commit hash, the diff,
  gate outputs). Do NOT push/PR/merge/prod — Opus reviews, then drives the combined push to stage.

## Context (already done — don't redo)
- Migration List is now at its true 6,114 on stage (the 4 QA-test leads were restored by Opus).
- Phases 1/2/2.1 are committed on this branch. Phase 2.1 (RPC restrict + reconciliation tooltips) may
  still be in flight in your session — this merge-gating is independent and can layer on top.
- DEFERRED (NOT this brief): the "Existing Leads (edgeX)" second staging list + emptying All Leads.

# BRIEF — Lead Lists reorder polish (3 fixes)

**Owner (planner):** Opus session · **Executor:** Sonnet session
**Branch:** `fix/lead-lists-reorder-polish` (already created off latest `origin/stage`)
**Target:** PR → `stage` only. Do NOT touch `main`. Stop at a self-report — no self-merge, nothing on prod.
**Migration:** none. No API change. All changes are in ONE file: `src/components/dashboard/settings/lead-lists-manager.tsx`.

Follow-up to the merged drag-and-drop reorder (PR #137). Three issues to fix.

---

## Fix 1 — Sidebar nav doesn't update live after a reorder

**Root cause:** the sidebar is rendered by the **server** layout (`src/app/(main)/(dashboard)/layout.tsx`
→ `getLeadListsByTenant` → passed straight through `shell.tsx` to `LeadListsNavGroup`, NOT snapshotted
into client state). The settings panel is a client component that re-fetches its own copy, but nothing
re-runs the server layout, so the nav keeps its stale prop until a full page reload. `persistOrder` has
no `router.refresh()`.

**Fix:** in `lead-lists-manager.tsx`, import `useRouter` from `next/navigation` and call
`router.refresh()` after a **successful** reorder (inside `persistOrder`, after the fetch succeeds).
This re-runs the server layout so the sidebar "All Leads" order updates live. Do NOT call it on failure
(we revert local state there instead).

## Fix 2 — No "saved" confirmation toast on reorder

**Root cause:** `persistOrder` only fires `toast.error(...)` on failure; there's no success toast. The
bottom-right notifications are the Sonner `<Toaster />` (mounted in `(main)/layout.tsx`); `toast` from
`sonner` is already imported in the manager.

**Fix:** after a successful reorder in `persistOrder`, fire `toast.success("List order saved")`.

## Fix 3 — Group Archive + Delete separately, exclude them from sorting

The app already has the exact categorization: `isOffFunnelLeadList(list)` in
`src/lib/leads/list-funnel.ts` returns `list.is_archive === true || list.slug === "delete"` — i.e. ONLY
"Archived" + "Delete" (NOT the funnel system lists New Leads / Contacted / Qualified). It's a pure,
client-safe function — import it directly.

**Fix — split the manager's list into two rendered groups:**

- **Sortable group** = `lists.filter((l) => !isOffFunnelLeadList(l))` — rendered inside the existing
  `DndContext`/`SortableContext`, draggable + up/down arrows, exactly as now.
- **Pinned group** = `lists.filter((l) => isOffFunnelLeadList(l))` — rendered BELOW the sortable group
  under a small section label **"Archive & Delete"** (muted, e.g. `text-xs font-medium text-muted-foreground`
  with a top divider). These rows have **no drag handle and no up/down arrows** — edit (pencil) only.
  (They're system lists, so no delete button already.)

**Keep `sort_order` globally consistent (important):** `persistOrder` currently sends the full ordered
id array to `PATCH /api/v1/lead-lists/reorder`, which re-sequences `sort_order = index`. Keep sending the
FULL set, composed as **`[...funnelInDragOrder, ...offFunnelPinned]`**, so:
- the endpoint stays unchanged,
- funnel lists get `sort_order` 0…k-1 and Archive/Delete get k…n-1 — i.e. off-funnel **always sorts after**
  the funnel (matching the sidebar, which renders Archived/Delete as standalone items below "All Leads"),
- no collisions, `sort_order` stays contiguous.

Concretely:
- Drag `onDragEnd` and the arrow `handleReorder` should reorder **only within the funnel group**, then
  call `persistOrder([...newFunnelOrder, ...offFunnelLists])`.
- The arrows' `isFirst`/`isLast` bounds must be relative to the **funnel group**, not the full list.
- `SortableContext items` = the funnel group ids only. Off-funnel rows are plain rows (not `useSortable`),
  so extract/guard the row so a non-draggable variant renders without a grip handle.

Preserve the off-funnel group's existing relative order (e.g. keep them in the order the API returned,
which is `sort_order` ascending) when appending.

Edge note (no action needed unless you see them): `is_staging` "Leads Organise" buckets are not
off-funnel; if any appear for a tenant they'd fall in the sortable group — that's fine for now, out of
scope. Zunkiree/Admizz test tenants show only funnel + Archive + Delete.

---

## Verify before reporting back

- `npm run build` clean AND `npx eslint --max-warnings 50` clean.
- Local `npm run dev` against the **stage** DB (`dymeudcddasqpomfpjvt`, passwords `edgexdev123`):
  - **Zunkiree Labs (it_agency):** Settings → Lead Management. Confirm Archived + Delete now render in a
    separate **"Archive & Delete"** group with no drag handle / no arrows. Drag a funnel list (e.g.
    Qualified above Contacted) → (a) a **"List order saved"** toast appears bottom-right, (b) the sidebar
    "All Leads" order updates **without a manual page reload**, (c) refresh the page and confirm it
    persisted. Confirm arrows still reorder within the funnel and can't move a list into the pinned group.
  - **Admizz (education, `hello@admizz.org` / `edgexdev123`):** open a lead, confirm **"Send to next" /
    Revert** still steps correctly (funnel order unchanged; Archive/Delete still last).
- Report: files changed (should be just the one), build + lint output, and the manual-test results.
  **Do not merge; nothing on main/prod.**

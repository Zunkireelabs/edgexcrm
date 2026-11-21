# BRIEF — Drag-and-drop reorder for Lead Lists

**Owner (planner):** Opus session · **Executor:** Sonnet session
**Branch:** `fix/lead-lists-drag-reorder` (already created off latest `origin/stage`)
**Target:** PR → `stage` only. Do NOT touch `main`. Stop at a self-report — do not self-merge or apply anything to prod.
**Migration:** none (the `sort_order` column already exists).

---

## Goal

Make the Settings → Lead Management → **"Lead Lists"** panel reorderable by **drag-and-drop**, while
**keeping the existing up/down arrows** as a fallback. Ship for **all 3 industries** that have the
feature (education_consultancy, travel_agency, it_agency). Sidebar order already reads `sort_order`,
so it reflects the new order automatically.

## Why (and the one latent bug to fix)

Reordering already exists via the up/down chevrons: each click swaps the `sort_order` of two adjacent
rows via two PATCH calls. **Bug:** new lists default to `sort_order = 99`, so multiple rows share `99`
and the pairwise swap becomes a **no-op** (e.g. `Pre-Qualified` can't move up past another `99` row).
Doing drag properly — **re-sequencing all rows to `0,1,2,…` on drop** — fixes this. Rewire the arrows
to the same re-sequencing path so they're fixed too.

## What must NOT change (blast radius — all positional on `sort_order`, keep it valid & contiguous)

`sort_order` is consumed by several places. Do not modify their logic; just keep writing valid
contiguous `sort_order` values and they all keep working:

- **Sidebar order** — `src/lib/supabase/queries.ts` `getLeadListsByTenant` (ordered by `sort_order`).
- **"Send to next" / Revert** — `src/components/dashboard/leads/list-stepper.tsx` computes the
  next/prev stage as the `sort_order` neighbour. This is the Admizz-critical feature — leave its logic
  untouched.
- **Education Classes/Applications card gates** — `src/app/(main)/(dashboard)/leads/[id]/page.tsx`
  compares current list `sort_order` vs `qualified`/`prospects`.
- **Counselor auto-promotion** — `src/app/(main)/api/v1/leads/[id]/route.ts` moves to `prospects`
  based on a `sort_order` threshold.

Drag is only a **new input method** for a reorder that already exists — it writes the same
`sort_order` column the arrows already write. No new coupling.

---

## Task 1 — Bulk reorder API endpoint

Create `src/app/(main)/api/v1/lead-lists/reorder/route.ts` with a `PATCH` handler:

- Guards, matching `src/app/(main)/api/v1/lead-lists/[id]/route.ts`:
  `authenticateRequest()` → `getFeatureAccess(auth.industryId, FEATURES.LEAD_LISTS)` → `apiForbidden()`
  on fail → `requireAdmin`.
- Body: `{ order: string[] }` — ordered array of `lead_lists.id`.
- Validate **every** id belongs to the tenant (via `scopedClient(auth)`); if any id is not one of the
  tenant's lists, return `apiError(...)` and write nothing.
- Re-sequence: assign `sort_order = index` for each id in `order`. Persist with scoped updates
  (`db.from("lead_lists").update({ sort_order }).eq("id", id)` — remember `scopedClient` still
  requires a caller-supplied `.eq` filter beyond the auto-injected `tenant_id`).
- Return `apiSuccess(...)`.

## Task 2 — Drag-and-drop UI

In `src/components/dashboard/settings/lead-lists-manager.tsx`:

- Reuse the existing `@dnd-kit` vertical-sortable pattern from
  `src/industries/_shared/features/form-builder/components/step-editor.tsx`
  (`DndContext` + `SortableContext` + `verticalListSortingStrategy`, `PointerSensor` with
  `activationConstraint: { distance: 5 }`, `closestCenter`) and
  `src/industries/_shared/features/form-builder/components/field-row.tsx`
  (`useSortable` + `GripVertical` handle from `@dnd-kit/utilities`).
- Add a grip handle to each list row. On drag end: compute the new ordered id array, **optimistically**
  update local state, then call the new reorder endpoint. On failure → revert local state + toast.
- **Keep the up/down arrows.** Rewire BOTH arrows and drag to build the full new ordered array and call
  the **same** reorder endpoint (this fixes the shared-`99` no-op bug for arrows too).
- System lists stay draggable; keep existing rules (system lists not deletable). **No new industry
  gate** — ship for all 3.

---

## Verify before reporting back (do not skip)

- `npm run build` clean **and** `npx eslint --max-warnings 50` clean.
- Local `npm run dev` against the **stage** DB (`dymeudcddasqpomfpjvt`). Passwords on stage are
  `edgexdev123`.
  - **Zunkiree Labs (it_agency)** — Settings → Lead Management: drag `Pre-Qualified` up under
    `Qualified`; confirm it persists on refresh AND the sidebar "All Leads" sub-items reflect the new
    order. Confirm the up/down arrows still work.
  - **Admizz (`hello@admizz.org` / `edgexdev123`, education)** — open a lead detail; confirm
    **"Send to next" / Revert still walk the stages correctly** after a reorder, and Classes/Applications
    cards still behave.
- Report: files changed, the endpoint contract, build + lint output, and the manual-test results.
  **Do not merge; do not push to main; do not apply anything to prod.**

# BUILD BRIEF — Relocate row `⋯` to a front hover slot; remove trailing Actions column

**Author:** Opus (planning/review brain) · **Executor:** Sonnet · **Branch:** `feature/lead-row-actions-front` (off `stage`)
**Date:** 2026-06-10 · **Scope:** Global (universal leads table). Small UI change, no backend/migration.

> **STOP-AT-REVIEW.** Build on this branch only. No merge, no push, no shared-DB writes. Hand back
> for Opus review (both gates re-run). This gate has been overstepped before — honor it.

---

## 1. What & why

The leads table currently has a trailing **"Actions" column** on the far right holding an **eye**
(duplicate "open detail" link) and the **`⋯`** menu we added for Edit. It eats a permanent column.
Sadin wants the `⋯` **at the front of the row, on hover only**, in a small reserved slot — and the
whole trailing Actions column gone. Preview is unaffected because it already lives as an inline
hover chip next to the name (see §4).

**End state:** a thin reserved slot **between the checkbox and the avatar**, empty at rest, `⋯`
fades in on row hover (and stays while its menu is open). No trailing Actions column. No eye there.
Avatar untouched (do NOT swap the avatar).

```
NOT HOVERED                                   HOVERED
┌────┬─────┬──────┬───────────────┐           ┌────┬─────┬──────┬───────────────┐
│ ☐  │     │ (KT) │ Kritesh Thapa │   →       │ ☐  │  ⋯  │ (KT) │ Kritesh Thapa │
└────┴─────┴──────┴───────────────┘           └────┴─────┴──────┴───────────────┘
        ▲ reserved (empty)                            ▲ ⋯ on hover → Edit
   (no trailing Actions column anymore)
```

---

## 2. Changes — `src/components/dashboard/leads-table.tsx`

1. **Remove the trailing `⋯` column we added** (the one introduced on the lead-edit branch):
   - The trailing header `<th className="px-2 py-2 text-left w-8"></th>` after `visibleColumns.map(renderTh)` (~line 951-952).
   - The trailing actions `<td>` block with the `DropdownMenu` (~lines 990-1010).
2. **Add `group`** to the row `<tr>` className (currently `hover:bg-gray-50 transition-colors ...`).
3. **Insert a new reserved anchor — between the checkbox and the avatar — in BOTH header and body:**
   - **Header:** a thin empty `<th className="px-2 py-2 w-8"></th>` immediately **after** the select
     `<th>` and **before** the avatar `<th>`.
   - **Body:** a new `<td>` immediately **after** the checkbox `<td>` and **before** the avatar `<td>`,
     containing the `⋯` DropdownMenu (moved from the deleted trailing cell). The td keeps
     `onClick={(e) => e.stopPropagation()}` so clicking `⋯` doesn't trigger row nav/selection.
   - **Reserved-space + hover behavior (the important bit):** use **opacity**, not `hidden`, so the
     slot always reserves its width and there is **zero layout shift** when `⋯` appears:
     ```tsx
     <td className="px-2 py-1.5 w-8" onClick={(e) => e.stopPropagation()}>
       <DropdownMenu>
         <DropdownMenuTrigger asChild>
           <button
             type="button"
             aria-label="Row actions"
             className="h-6 w-6 rounded flex items-center justify-center text-gray-400
                        hover:text-gray-700 hover:bg-gray-100 transition-all
                        opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
           >
             <MoreHorizontal className="h-3.5 w-3.5" />
           </button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="start">
           <DropdownMenuItem onClick={() => router.push(`/leads/${lead.id}?edit=1`)}>
             <Pencil className="h-4 w-4 mr-2" />
             Edit
           </DropdownMenuItem>
         </DropdownMenuContent>
       </DropdownMenu>
     </td>
     ```
     `data-[state=open]:opacity-100` keeps `⋯` visible while the menu is open even if the cursor
     leaves the row (Radix sets `data-state="open"` on the trigger). Change `DropdownMenuContent`
     `align` from `end` → `start` since it now opens from the left.
4. **Fix `totalColSpan`.** It was `2 + visibleColumns.length + 1` (the trailing-column version).
   Set it to **`3 + visibleColumns.length`** — three fixed anchors now (select + `⋯`-slot + avatar),
   and `visibleColumns` no longer includes the removed registry "actions" column (see §3).

---

## 3. Changes — `src/components/dashboard/leads/columns-registry.tsx`

1. **Delete the `actions` column object** (the `{ key: "actions", label: "Actions", required: true,
   defaultVisible: true, renderTh … "Actions" … , renderTd … trailing `<Eye>` Link … }`, ~lines
   656-680).
2. **Simplify `getLeadColumns` assembly** (~lines 716-719): there is no `actions` column to find/append
   anymore. Remove the `actionCol` lookup (the `staticCols.find(c => c.key === "actions")!` would be
   `undefined` and corrupt the array). Replace the return with:
   ```ts
   return [...staticCols, ...customCols];
   ```
   (Custom-field cols simply append after the standard/industry cols now.)
3. **Keep** the `Eye` import — it's still used by the inline name-preview chip (line ~154) and the
   mobile preview (line ~170). Keep `onPreviewToggle` in the context type. **Do not touch** the
   inline "👁 Preview" chip (lines ~147-172) — that is the real preview affordance and must stay.

---

## 4. Do NOT touch (preview is already handled)

The hover **"👁 Preview" chip next to the name** (`columns-registry.tsx:147-157`, desktop) +
the mobile eye (164-172) call `onPreviewToggle` and open the side-preview panel. This is the
preview feature and is **unchanged**. The eye we're deleting (in the trailing Actions column) was a
*duplicate* `Link` to the detail page, not the preview — removing it loses nothing.

Also leave untouched: selection checkboxes, bulk toolbar (assign/delete/merge/export), Column
Manager, all registry data columns, and every existing inline control.

---

## 5. Column Manager note

The removed `actions` column was `required: true` so it never appeared as a toggle — removing it
from the registry cleanly drops it from the manager too. If any per-industry default-visibility map
lists `"actions"` as a key, it becomes a harmless no-op; no need to chase those down, but don't add
new references to it.

---

## 6. Definition of done

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` → 0 errors (and no NEW warnings in the two changed files —
      check for now-unused imports like `MoreHorizontal`/`Pencil` if anything was left dangling).
- [ ] Leads table: no trailing "Actions" column; no eye on the right; horizontal real estate reclaimed.
- [ ] At rest, the front slot (between checkbox and avatar) is empty — avatar sits where it always did,
      no visual change to non-hovered rows.
- [ ] On row hover, `⋯` fades into the front slot with **zero layout shift** (rest of the row doesn't
      move). Click `⋯` → menu opens (aligned left) → **Edit** → `/leads/[id]?edit=1` (opens edit mode).
- [ ] `⋯` stays visible while its menu is open even if the cursor leaves the row.
- [ ] The inline "👁 Preview" chip next to the name still appears on hover and still opens the side
      panel (unchanged).
- [ ] Clicking `⋯` does not select the row or navigate to the detail page (stopPropagation holds).
- [ ] Works across industries (education / it_agency / travel / construction) — it's a universal anchor.

---

## 7. Files

| File | Change |
|---|---|
| `src/components/dashboard/leads-table.tsx` | remove trailing `⋯` col; add `group` on row; insert reserved `⋯` slot between checkbox & avatar (opacity hover, stays-open); `totalColSpan = 3 + visibleColumns.length` |
| `src/components/dashboard/leads/columns-registry.tsx` | delete `actions` column object; simplify `getLeadColumns` return to `[...staticCols, ...customCols]`; keep `Eye`/`onPreviewToggle` for the inline preview |

Keep the diff tight, match surrounding Tailwind/shadcn idioms. Build + lint green, then hand back to
Opus — **no merge, no push.**

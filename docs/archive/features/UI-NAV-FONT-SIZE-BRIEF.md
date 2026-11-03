# BRIEF D — Sidebar nav labels to 13px

**For:** Sonnet execution session
**Branch:** `feature/ui-updates-it-agency` (same branch — do NOT branch again)
**Type:** UI-only. No API, no DB, no deps.
**Reviewer:** Opus reviews + re-runs gates. **Stop at the review gate — no PR, no merge, no deploy.**

---

## 0. Goal
Make the **sidebar navigation labels** 13px (they're currently `text-sm` = 14px). Tailwind has no 13px token, so use the arbitrary value **`text-[13px]`**, paired with **`leading-5`** to preserve the current 20px line-height (so row heights / vertical rhythm don't shift — `text-sm` was 14px/20px).

**Change:** at each nav-label site, replace `text-sm` → `text-[13px] leading-5`. Leave `font-medium`, colors, padding, and every other class intact.

## ⚠️ Scope
Only `src/components/dashboard/shell.tsx`, and only the **nav-item label** sites listed below. This is the universal shell → affects the sidebar for **all tenants** (fine — it's global polish). Do NOT touch anything outside the list.

---

## 1. Sites to change (all in `src/components/dashboard/shell.tsx`)
These are the sidebar nav-item labels (section-parent buttons, child items, the disabled/locked `div` variants, and Global Search — all currently `text-sm`):

| Line | Element |
|---|---|
| ~174 | nav section-parent button (`text-sm font-medium`) |
| ~196 | nav child item (`text-sm`) |
| ~329 | nav item variant (`text-sm font-medium`) |
| ~406 | Global Search button (`text-sm font-medium`) |
| ~439, ~451, ~511, ~525, ~578, ~596 | nav-item `div` variants (`text-sm font-medium text-gray-500`) |

At each: `text-sm` → `text-[13px] leading-5`. Verify by matching the class string, not just the line number (lines may have drifted from the earlier commits on this branch).

> Best-quality note: these ~10 sites duplicate the same label classes inline (pre-existing pattern). A clean refactor would extract a shared `navLabelClass` constant — **but that's out of scope here**; do the straight swap to keep the diff tight and reviewable. Flag the duplication in your report if you want it queued as a follow-up.

## 2. Do NOT touch (not nav labels)
- Section headers ~line 139 (`text-[11px]`) — already small.
- Ops/Orca tabs ~389/393 (`text-xs`).
- Account footer / avatar / user menu ~644/650/651/662/665/677/689.
- Assistant button ~748 (header).
- Any `Badge` / `kbd` / count text.

---

## 3. Verify before reporting
1. `npm run build` — clean.
2. `npx eslint src/components/dashboard/shell.tsx --max-warnings 0` — clean.
3. `npx tsc --noEmit` — clean.
4. **Local dev** (Test Agency / it_agency): sidebar labels are visibly ~1px smaller (13px), the sidebar still looks uniform (no mixed sizes), and **row heights are unchanged** (leading-5 preserved the rhythm). Confirm 13px in DevTools on a couple of labels (Dashboard, All Leads).

## 4. Report back (for Opus review — do NOT merge)
- Confirm exactly `shell.tsx` changed, N sites swapped (should be ~10), each `text-sm`→`text-[13px] leading-5`.
- Screenshot of the sidebar at the new size.
- Confirm §3 gates + the row-height check.
- Commit on `feature/ui-updates-it-agency` (a focused commit, e.g. `style(sidebar): nav labels to 13px`), **no PR**. Report the SHA.
```

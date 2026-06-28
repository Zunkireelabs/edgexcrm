# BRIEF — Settings Modal: match main dashboard colors — for Sonnet

> Small UI pass on `feature/settings-modal`. Use `/frontend-dev`. Build + lint, commit, STOP and report.
> No push/PR/merge/prod. Sadin verifies UI. Goal: make the Settings modal's left nav + right panel use the
> SAME color tokens as the main dashboard sidebar so it feels native.

## Exact color tokens (from the main dashboard; all confirmed in `shell.tsx`)
- Sidebar / canvas bg: **`#fafafa`**
- Nav item ACTIVE + HOVER bg: **`#ebebeb`**, text **`text-gray-900`** (#111827)
- Nav item IDLE text: **`text-gray-500`** (#6b7280)  — unchanged, already matches
- Divider/border: **`#e5e7eb`** (gray-200) — keep the existing `border-r` style, just recolor

## Changes

### 1. `src/components/dashboard/settings/modal/settings-sidebar.tsx`
- **Container** (currently `bg-gray-50 border-r border-gray-100`):
  → `bg-[#fafafa] border-r border-[#e5e7eb]`
- **Category nav item — ACTIVE** state (currently `bg-white text-gray-900`):
  → `bg-[#ebebeb] text-gray-900`
- **Category nav item — IDLE/HOVER** (currently `text-gray-500 hover:bg-white`, no hover text):
  → `text-gray-500 hover:bg-[#ebebeb] hover:text-gray-900`
- Leave the org-identity block (name `text-gray-900`, role `text-gray-400`) and any section labels as-is.
- Swap EVERY `bg-white` / `hover:bg-white` used for category-item states to `#ebebeb`; don't change unrelated
  white surfaces if any.

### 2. `src/components/dashboard/settings/modal/settings-modal.tsx`
- **Right panel container** — the `<div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">`
  (the right side that currently inherits the white `bg-background`):
  → add **`bg-[#fafafa]`** so the right panel matches the dashboard canvas. (Inner manager cards stay white,
  so they read as cards-on-canvas exactly like the dashboard.)
- Leave the sidebar/panel structure, widths, and overlay (`bg-[#0000004d]`) untouched.

## Result (target)
Settings sidebar bg `#fafafa` (was `#f9fafb`), active/hover pills `#ebebeb` + `#111827` text (was white),
idle text `#6b7280`, divider `#e5e7eb` (was `#f3f4f6`), right panel `#fafafa` (was white) — identical to the
main dashboard sidebar + canvas.

## Gates / report
- `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Sadin verifies: settings sidebar + right panel colors match the main dashboard; active/hover pills are
  `#ebebeb`; inner cards still white.
- Commit on `feature/settings-modal`, STOP, report commit + diff + gates. No push/PR/merge/prod.

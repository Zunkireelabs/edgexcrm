# Design system: dropdown selectors — drop blue accents, neutral active state with tick-only selection signal

**Owner**: Opus (plan + review) → Sonnet (implement)
**Branch**: `chore/design-dropdown-retone`
**Base**: `stage` (currently `8791e66`)
**Scope**: The two custom dropdown selector components used in the dashboard chrome. Removes the blue active-state treatment in favor of a neutral pattern: subtle `#0000170b` hover overlay, near-black `#0f0f10` text, warm-muted `#787871` description text, and selection is signaled ONLY by the existing tick-icon (the filled radio circle), now in near-black. No DB / API / business logic touched.

## Why

After the primary-button retone (`f3ad73d`) and the table text hierarchy (`8791e66`), the leftover blue surfaces are concentrated in the FilterDropdown chips and PipelineSelector dropdown. When a filter is applied, the chip turns blue (`bg-blue-50 border-[#2272B4] text-[#2272B4]`); when an option is selected inside the open panel, the row also turns blue (`bg-blue-50` row bg + `text-[#2272B4]` text + blue radio circle). This now reads as an inconsistent leftover next to the near-black primary buttons and near-black name links.

Sadin's reference (Anthropic's `--gray-alpha-100` = `#0000170b`) is a near-transparent dark overlay used for subtle hover states. Combined with the existing tick-icon-in-radio-circle pattern as the *sole* indicator of selection, the dropdown feels calmer and consistent with the rest of the chrome.

## Files to change

Exactly two:
1. `src/components/ui/filter-dropdown.tsx`
2. `src/components/pipeline/PipelineSelector.tsx`

No other files. No new components. No CSS variables added.

## Color values used in this branch

| Purpose | Value | Notes |
|---|---|---|
| Hover overlay on rows + active trigger bg | `#0000170b` | Near-transparent dark; ~4% black with alpha. Matches Anthropic's `--gray-alpha-100`. |
| Primary text (option labels, active trigger text) | `#0f0f10` | Same as table name links from `8791e66`. |
| Active trigger border + selected radio circle fill | `#0f0f10` | Same near-black. |
| Secondary text (option descriptions) | `#787871` | Same as table secondary text from `8791e66`. |
| Search input focus ring | `gray-300` | Neutral; replaces blue. |

## Changes to `filter-dropdown.tsx` (10 edits, all className-only)

Read the current file end-to-end first. Then apply each edit verbatim.

**Edit 1 — Trigger button, active state** (line ~104):
- Before: `"border-[#2272B4] bg-blue-50 text-[#2272B4]"`
- After: `"border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]"`

**Edit 2 — Trigger button, inactive hover** (line ~105):
- Before: `"border-gray-300 bg-white text-gray-600 hover:bg-gray-50"`
- After: `"border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"`

**Edit 3 — Search input focus ring** (line ~137):
- Before: `"... focus:outline-none focus:ring-1 focus:ring-[#2272B4] focus:border-transparent"`
- After: `"... focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-transparent"`

**Edit 4 — Option row background, both states** (line ~160):
- Before: `${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`
- After: `hover:bg-[#0000170b]`
- The selected vs unselected branching at the row-bg level GOES AWAY. Both selected and unselected rows have the same baseline (transparent) and same hover (`#0000170b`). Selection is signaled only by the radio circle (Edit 5).
- Make sure the template literal still reads cleanly. The full className for the option button after this edit:
  ```ts
  className={`
    w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors
    hover:bg-[#0000170b]
  `}
  ```

**Edit 5 — Radio circle, selected state** (line ~167):
- Before: `${isSelected ? "border-[#2272B4] bg-[#2272B4]" : "border-gray-300"}`
- After: `${isSelected ? "border-[#0f0f10] bg-[#0f0f10]" : "border-gray-300"}`
- The white `Check` icon inside (line ~170) stays unchanged.

**Edit 6 — Option label text, both states** (line ~176–177):
- Before: `text-xs font-medium ${isSelected ? "text-[#2272B4]" : "text-gray-900"}`
- After: `text-xs font-medium text-[#0f0f10]`
- The branching disappears. Selected and unselected labels use the same `#0f0f10`. The full `<div>` className becomes:
  ```tsx
  className="text-xs font-medium text-[#0f0f10]"
  ```

**Edit 7 — Option description text** (line ~183):
- Before: `"text-[11px] text-gray-500 mt-0.5 truncate"`
- After: `"text-[11px] text-[#787871] mt-0.5 truncate"`

## Changes to `PipelineSelector.tsx` (8 edits + 1 judgment call)

This component mirrors FilterDropdown's structure. Read the surrounding code to make sure the edits land in the right scope.

**Edit A — Trigger button, active state** (line ~176):
- Before: `"border-[#2272B4] bg-blue-50 text-[#2272B4]"`
- After: `"border-[#0f0f10] bg-[#0000170b] text-[#0f0f10]"`

**Edit B — Trigger button, inactive hover** (line ~177):
- Before: `"border-gray-300 bg-white text-gray-600 hover:bg-gray-50"`
- After: `"border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"`

**Edit C — Search input focus ring** (line ~206):
- Before: `"... focus:outline-none focus:ring-1 focus:ring-[#2272B4] focus:border-transparent"`
- After: `"... focus:outline-none focus:ring-1 focus:ring-gray-300 focus:border-transparent"`

**Edit D — Option row background, both states** (line ~228):
- Before: `${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`
- After: `hover:bg-[#0000170b]`
- Same simplification as FilterDropdown Edit 4.

**Edit E — Radio circle, selected state** (line ~235):
- Before: `${isSelected ? "border-[#2272B4] bg-[#2272B4]" : "border-gray-300"}`
- After: `${isSelected ? "border-[#0f0f10] bg-[#0f0f10]" : "border-gray-300"}`

**Edit F — "Default" badge styling** (line ~245):
- Before: `"text-[10px] px-1.5 py-0.5 rounded bg-[#2272B4]/10 text-[#2272B4] font-medium shrink-0"`
- After: `"text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium shrink-0"`
- **JUDGMENT CALL**: this is a labeling badge ("Default" = this pipeline is the default), semantically different from selection state. I'm retoning it neutral because the brand-blue treatment now reads inconsistent with everything else in this component. Surface this in your handoff summary so Sadin can flag if the Default badge needs to stay visually distinctive. If he wants distinction, a follow-up edit can give it a soft amber or purple — but for now, neutral.

**Edit G — Pipeline name text, both states** (line ~250–251):
- Before: `text-xs font-medium truncate ${isSelected ? "text-[#2272B4]" : "text-gray-900"}`
- After: `text-xs font-medium truncate text-[#0f0f10]`

**Edit H — Pipeline metadata text** (line ~257):
- Before: `"text-[11px] text-gray-500 mt-0.5"`
- After: `"text-[11px] text-[#787871] mt-0.5"`

## What to LEAVE ALONE

- **Search icon color** (`text-gray-400`) in both files — neutral, fine.
- **Dropdown panel chrome**: `bg-white rounded-lg shadow-lg border border-gray-200`, the arrow pointer triangle, the animate-in classes — unchanged.
- **`Check` icon inside the radio circle**: stays `text-white` (now sits on a `#0f0f10` filled circle instead of `#2272B4` — still high contrast).
- **"No results found" empty state** (`text-xs text-gray-500 text-center`) — unchanged.
- **ChevronDown icon color** — inherits from parent text color, which on the active trigger is now `#0f0f10` instead of blue. No explicit edit needed.
- **The "Create New Pipeline" admin section at the bottom of PipelineSelector** (line ~268+, not shown in this brief's diff scope) — separate UI, unchanged. If you find blue accents there, leave them; out of scope.
- **All other dropdown-like UI**: shadcn `<Select>` primitive (Radix), shadcn `<DropdownMenu>` primitive, FilterMenu in other surfaces, TagMultiPicker. They render differently; the retone here only applies to these two custom components.
- **button.tsx**, **table cells**, **status badges**, **source pills** — all out of scope.
- **The two CSS variables (`--ring`, `--sidebar-primary`, `--chart-1`) that still reference `#2272B4`** — separate consolidation branch.

## Why we're hardcoding hex instead of adding tokens (again)

Same reasoning as the previous text-hierarchy brief: we have 10 instances across 2 files. Token consolidation (probably `--surface-hover: #0000170b`, `--ink: #0f0f10`, `--ink-muted: #787871`) is a clean future move but needs a deliberate naming convention. We'll do it when the colors hold up across more surfaces. For now, hardcoded hex.

## Verification matrix

Local before pushing:

- [ ] `npm run build` clean.
- [ ] `npx eslint --max-warnings 50 .` clean.
- [ ] As `admin@zunkireelabs.com` on dev:
  - `/leads`: filter chips at top of toolbar. Inactive chip ("All Counselors") stays gray with `#0000170b` hover. Apply a filter (pick "Unassigned") → chip becomes `bg-[#0000170b] border-[#0f0f10] text-[#0f0f10]`. No blue tint anywhere.
  - Open the same dropdown: search input ring on focus is neutral gray. Option rows are flat (no `bg-blue-50` on the selected row). Selected option has the filled near-black radio circle with white check; unselected options have the empty gray circle. Label text is `#0f0f10`; description is `#787871`. Hover any row → row gets `#0000170b` overlay. All five filter chips ("All Counselors", "All Sources", "Any time", "All Status", and "All Forms" if multi) behave the same.
  - `/contacts`: same behavior on the two FilterDropdown chips (Account, Status).
  - `/pipeline`: PipelineSelector pill at the top. Same retone — inactive trigger stays gray with `#0000170b` hover; active state retoned. Open the panel: option rows match the same pattern. The "Default" badge on the default pipeline now reads `bg-gray-100 text-gray-700` (neutral) — visually distinct from selection but no longer brand-blue. **Eyeball this and flag if Default needs more emphasis.**
- [ ] As education_consultancy admin: `/leads` filter chips on that tenant also use FilterDropdown — confirm the retone applies (they share the same component).
- [ ] As a counselor user: filter chips still gate on `isAdmin` for the Counselor filter (existing behavior), but the visual retone applies to whatever filters they see. No regression.
- [ ] Spot-check: no blue tints anywhere in either dropdown panel except potentially the search-input cursor color (browser default — out of scope).

## Edge cases to think about

- **Selected option AND hovered**: the row gets `hover:bg-[#0000170b]`. Selected vs unselected both get this on hover. No double-overlay or visual stacking.
- **Long option labels**: existing `truncate` / `max-w-[120px]` constraints stay — unchanged.
- **Disabled / loading states**: not used in these dropdowns today. Skip.
- **Mobile / narrow viewports**: the dropdown panel has fixed widths (`w-64` for FilterDropdown, `w-72` for PipelineSelector). Test that they still render reasonably on narrow viewports. No change expected.

## Code-review checklist (6 standing items)

All N/A — pure className-only change, no DB / no API / no new page / no `<SelectItem value="">` / no PostgREST embed / no cross-cutting predicate.

## Handoff format

Sonnet pushes the branch when done and stops. Opus fetches, reviews diff, runs gates, smokes dev after deploy, squash-merges to stage. Sadin smokes visually before any prod push.

---

## Handoff prompt (paste to Sonnet)

```
You are implementing a dropdown-retone styling change on a fresh feature branch in the Lead Gen CRM repo at /Users/sadinshrestha/Projects/edgeXcrm. Full instructions are in the brief at docs/DESIGN-DROPDOWN-RETONE-BRIEF.md — read it end-to-end before writing any code, then follow it precisely.

This is a tightly-scoped className-only change across EXACTLY two files:
1. src/components/ui/filter-dropdown.tsx
2. src/components/pipeline/PipelineSelector.tsx

The goal: remove the blue active/selected treatment from both dropdown selectors. Replace with: subtle #0000170b hover overlay (Anthropic-style ~4% black-with-alpha), #0f0f10 near-black text, #787871 warm-muted description text, neutral gray search-ring. Selection is signaled ONLY by the existing radio-circle+check icon (now filled #0f0f10 instead of blue). The brief specifies exact line-by-line edits for both files — 7 edits in filter-dropdown.tsx, 8 in PipelineSelector.tsx (plus 1 judgment call on the "Default" badge in PipelineSelector — retone to bg-gray-100 text-gray-700 per the brief, then surface in your summary so Sadin can override if Default needs more visual distinction).

Workflow:

1. From repo root: git checkout stage && git pull origin stage && git checkout -b chore/design-dropdown-retone.
2. Read the brief, then read both target files end-to-end so you know exactly which lines you're touching. Spot-check line numbers because file lengths may have shifted slightly.
3. Apply the edits in the brief in order:
   - filter-dropdown.tsx: Edits 1–7. Two of them (Edit 4 row-bg, Edit 6 label-text) REMOVE the isSelected branching and collapse to a single className — make sure the template literal is clean after the edit, no dangling ternaries.
   - PipelineSelector.tsx: Edits A–H. Same collapse pattern in Edits D and G.
4. Before pushing, grep both files for residual #2272B4:
   - grep -n '2272B4' src/components/ui/filter-dropdown.tsx — should return ZERO matches after your edits.
   - grep -n '2272B4' src/components/pipeline/PipelineSelector.tsx — should return ZERO matches if you also retoned the Default badge per Edit F.
   If any blue residue remains, STOP and report — don't guess.
5. LEAVE ALONE per the brief: dropdown panel chrome (bg-white rounded-lg shadow-lg etc.), the Check icon's text-white, search icon's text-gray-400, "No results found" text, Create-New-Pipeline admin section in PipelineSelector, button.tsx, table cells, status badges, source pills, all other Select / DropdownMenu primitives.
6. Run BOTH gates locally before pushing:
   - npm run build — must finish clean.
   - npx eslint --max-warnings 50 . — must finish clean.
7. Commit with a single descriptive message. Standard project style. Do NOT include any Claude/Anthropic co-author trailer; the commit-msg hook handles co-authoring.
8. Push: git push -u origin chore/design-dropdown-retone. DO NOT open a PR. DO NOT merge. Stop after the push.

Final summary should report: (1) diff stat (files / insertions / deletions), (2) build + eslint exact tail output, (3) commit SHA + branch push confirmation, (4) the grep result for #2272B4 in both files (confirming zero matches), (5) anything you noticed — especially: did the template literals collapse cleanly after removing the isSelected branching? Did the Default-badge retone land correctly? Any other blue accents you spotted in the two files that weren't covered by the 15 edits in the brief? Surface anything that looks wrong rather than working around it.
```

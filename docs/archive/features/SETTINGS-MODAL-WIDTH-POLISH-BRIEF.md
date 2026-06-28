# BRIEF — Settings Modal width + content-fill polish — for Sonnet

> Small UI pass on `feature/settings-modal` (continues the Phase-1 work). Use `/ui-ux-expert` +
> `/frontend-dev`. Build + lint, commit, STOP and report. No push/PR/merge/prod. Sadin verifies UI.
> Goal: match the Manus/Linear reference — a WIDE modal whose content sits in a tidy readable COLUMN,
> not a 512px cramped box and not a stretched-full-width form.

## Problem (diagnosed)
1. **Modal capped at 512px.** `src/components/dashboard/settings/modal/settings-modal.tsx:64` passes
   `max-w-[1320px]` but the base `DialogContent` (`ui/dialog.tsx:64`) ends with `sm:max-w-lg`. Because the
   breakpoint variant differs, tailwind-merge keeps BOTH, and `sm:max-w-lg` wins on desktop → 512px.
2. **No content width constraint.** `PanelContent` in
   `src/components/dashboard/settings/modal/panel-shell.tsx` is `px-8 py-6` with no max-width, so at the
   correct wide modal, form panels stretch edge-to-edge (ugly). Reference keeps content ~700px wide.
3. **Double header.** `panels/general-panel.tsx` renders `PanelHeader "General"` AND `SettingsForm`'s own
   "Organization" card header → redundant stacked titles.

## Fixes

### 1. Modal width — use Manus's EXACT values (from their DevTools)
Manus modal at ≥768px: `width: 80vw; max-width: 1440px; min-width: 720px`. In `settings-modal.tsx:64`
set the `DialogContent` className to (the `sm:max-w-[1440px]` is REQUIRED to beat the base `sm:max-w-lg`
512px cap; `min-w` guarded at md so phones don't overflow):
```
className="w-[90vw] md:w-[80vw] max-w-[1440px] sm:max-w-[1440px] md:min-w-[720px] h-[85vh] p-0 flex gap-0 overflow-hidden"
```

### 1b. Overlay/backdrop color — Manus uses #0000004d (≈ black/30), lighter than our default
The shared `DialogOverlay` is hardcoded to `bg-black/50` and `DialogContent` renders it without a className
passthrough (`src/components/ui/dialog.tsx`). To scope the lighter overlay to ONLY the settings modal (do
NOT change `bg-black/50` globally — it affects every dialog):
- Add an optional `overlayClassName?: string` prop to `DialogContent` and forward it:
  `<DialogOverlay className={overlayClassName} />`. Backward-compatible (optional).
- In `settings-modal.tsx`, pass `overlayClassName="bg-[#0000004d]"` on the `DialogContent`.
(tailwind-merge will drop the base `bg-black/50` in favor of `bg-[#0000004d]`.)

### 2. Content column (so content fills nicely, not stretched)
Give panels a comfortable reading column like the reference. Add an optional width mode to `PanelContent`:
- Default → `max-w-3xl` (~768px) for FORM-style panels (General, AI&Orca, Compliance, Communications
  identity, Integrations) so content reads as a column.
- A `wide` variant (full width) for TABLE/grid-heavy panels (Lead Management = lead-lists table,
  Team & Roles = positions, Organization = entities/branches, Communications = email rules) so tables keep
  room.
```tsx
export function PanelContent({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="px-8 py-6">
      <div className={cn("space-y-6", wide ? "max-w-none" : "max-w-3xl")}>{children}</div>
    </div>
  );
}
```
Pass `wide` from the table-heavy panels; leave forms on the default column. (Drop the redundant
`h-full overflow-y-auto` here — the modal's right panel already scrolls in `settings-modal.tsx`.)

### 3. De-double-frame
Where a panel's `PanelHeader` duplicates the inner manager's own card header, remove ONE. Cleanest: keep the
`PanelHeader` (consistent section title) and have the composed manager render WITHOUT its own outer card
chrome inside the modal — or, lowest-touch: drop the `PanelHeader` for panels whose single manager already
shows a titled card (e.g. General → SettingsForm's "Organization" card). Pick one approach and apply
consistently so every panel has exactly ONE section title at the top.

## Optional (mark Phase 2 — do NOT do now unless quick)
The reference's row pattern (label+description left, control/action right, dividers) is a per-manager
restyle the user deferred ("reorganize as-is"). Don't redesign manager internals in this pass — just the
modal width + content column + single header. Note it for Phase 2.

## Gates / report
- `npm run build` clean · `npx eslint --max-warnings 50` clean.
- Sadin verifies: modal is wide (~1320/90vw), General/form panels show a tidy centered-ish column (not
  stretched, not cramped), table panels use the width, one header per panel.
- Commit on `feature/settings-modal`, STOP, report commit + diff + gates. No push/PR/merge/prod.

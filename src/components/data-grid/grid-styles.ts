// Shared table metrics of the v2 data grid (EDGEX-117 Leads v2; shared with the Applications List,
// EDGEX-141 Phase 4): 36px rows, 38px header, 1px inset hairlines, the 16px checkbox, the sticky
// first column's scroll edge. Moved verbatim out of leads-grid.tsx; Leads renders the same classes.

// Mockup checkbox: 16px, 5px radius, 1.5px ghost inset border, accent fill when checked.
export const CHECKBOX_CLASS =
  "size-4 rounded-[5px] border-0 bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-ghost)] dark:bg-ds-surface data-[state=checked]:bg-ds-accent data-[state=checked]:text-white data-[state=checked]:shadow-none data-[state=indeterminate]:bg-ds-accent data-[state=indeterminate]:text-white data-[state=indeterminate]:shadow-none";

// Name column edge (EDGEX-148): the divider is the same 1px inset hairline every cell draws. When the
// grid is scrolled sideways a 1px strip ::after on each sticky Name cell (box-shadow, clipped to the row) fades in to the right
// (scroller data-scrolled + group/grid). The strip overshoots 24px above/below and the clip removes the blur's end fade, so rows join without seams. No gradients: those mean Orca.
export const NAME_EDGE =
  "after:pointer-events-none after:absolute after:left-[calc(100%-1px)] after:w-px after:-top-6 after:-bottom-6 after:content-[''] after:shadow-[6px_0_16px_4px_rgba(0,0,0,.12)] after:[clip-path:inset(24px_-48px_24px_1px)] after:opacity-0 after:transition-opacity after:duration-200 group-data-[scrolled=true]/grid:after:opacity-100";
// Name cells stay overflow-visible so the pseudo isn't clipped; truncation moves to this inner wrapper.
export const NAME_CLIP = "overflow-hidden whitespace-nowrap";

export const CELL_BASE = "h-9 overflow-hidden whitespace-nowrap px-3 align-middle shadow-[inset_-1px_0_0_var(--ds-border)] border-b border-ds-border";
export const CELL_BASE_NAME = CELL_BASE.replace("overflow-hidden ", "");
export const HEAD_BASE = "h-[38px] p-0 align-middle shadow-[inset_-1px_0_0_var(--ds-border)] border-b border-ds-border bg-ds-surface text-left";

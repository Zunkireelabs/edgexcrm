// Shared class strings for the leads toolbar v2 (EDGEX-116). Measured from the approved
// mockup (temp_ss/leads-table-v2.html, Attio reference): 28px controls, 8px radius, hairline
// `inset 0 0 0 1px` borders, 10px-radius popovers, 32px menu rows. Colours come from the
// `ds-` tokens only (globals.css); the one literal is the popover shadow, which the spec gives
// verbatim and which has no token.

/** Bare 28px control (ghost until hovered). */
export const CTRL =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm px-2 text-sm font-medium text-ds-ink transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost disabled:pointer-events-none disabled:opacity-50";

/** Hairline-bordered control. */
export const CTRL_BORDERED = `${CTRL} shadow-[inset_0_0_0_1px_var(--ds-border)]`;

/** Muted ghost control (the "Sorted by" / "Filter" chips). */
export const CTRL_MUTED =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm px-2 text-sm font-medium text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";

/** Primary call-to-action: DS accent, not Attio blue (brief: "CTA/links use DS tokens"). */
export const CTRL_PRIMARY =
  "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ds-sm bg-ds-accent px-2.5 text-sm font-medium text-white transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost disabled:pointer-events-none disabled:opacity-50";

/** Popover surface. Overrides PopoverContent's default w-72/border/p-4/rounded-md/shadow-md. */
export const POP =
  "w-auto rounded-[10px] border-0 bg-ds-surface p-1 text-sm font-medium text-ds-ink shadow-[0_0_0_1px_rgba(16,17,18,.06),0_8px_24px_-4px_rgba(16,17,18,.14),0_2px_6px_rgba(16,17,18,.06)]";

/** 32px menu row. */
export const ITEM =
  "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-ds-xs px-2 text-left text-sm font-medium text-ds-ink outline-none transition-colors hover:bg-ds-hover focus-visible:bg-ds-hover data-[active=true]:bg-ds-hover";

/** Group label inside a popover ("Most used", "All fields"). */
export const POP_LABEL = "px-2 pb-0.5 pt-1.5 text-xs font-medium text-ds-faint";

/** Hairline divider between popover groups. */
export const POP_SEP = "-mx-1 my-1 h-px bg-ds-divider";

/** Search row pinned to the top of a popover. */
export const POP_SEARCH =
  "-mx-1 -mt-1 mb-1 flex h-9 items-center gap-2 rounded-t-[10px] border-b border-ds-divider px-2.5 text-ds-faint";

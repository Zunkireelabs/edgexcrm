/**
 * EDGEX-145 Dialogs v1: the one Attio two-layer dialog surface.
 * A frosted outer layer (4px padding, 16px radius, white at 60% with 16px blur, 3-part shadow)
 * around a white inner card (12px radius, 1px hairline). Shared by command-dialog, ui/dialog and
 * ui/alert-dialog so there is a single source of truth.
 */

/** The frosted outer layer. `p-1!` is important so a consumer's `p-0` can't strip the frost ring. */
export const DIALOG_SHELL =
  "flex flex-col rounded-[16px] bg-[rgba(255,255,255,.6)] p-1! backdrop-blur-[16px] shadow-[0_8px_28px_-6px_rgba(28,40,64,.12),0_18px_88px_-4px_rgba(28,40,64,.16),0_0_1px_rgba(28,40,64,.16)] outline-none";

/** The white inner card. */
export const DIALOG_CARD =
  "flex flex-col overflow-hidden rounded-[12px] bg-ds-surface shadow-[0_0_0_1px_rgba(28,40,64,.08),0_1px_2px_rgba(28,40,64,.04)]";

/**
 * Dialog widths: sm 440, md 560, lg 720, each capped to the viewport minus 1rem gutters. Plain (unprefixed)
 * max-w so tailwind-merge drops it whenever a consumer passes ANY `max-w-*` (e.g. `max-w-md`); a consumer
 * `sm:max-w-*` still wins at sm and up.
 */
export const DIALOG_SIZES = {
  sm: "max-w-[min(440px,calc(100%-2rem))]",
  md: "max-w-[min(560px,calc(100%-2rem))]",
  lg: "max-w-[min(720px,calc(100%-2rem))]",
} as const;

export type DialogSize = keyof typeof DIALOG_SIZES;

/** Footer bar: 52px, hairline above, buttons on the right. Shared by DialogFooter and AlertDialogFooter. */
export const DIALOG_FOOTER =
  "sticky bottom-0 z-10 flex min-h-[52px] flex-col-reverse gap-2 border-t border-ds-divider bg-ds-surface px-4 py-2 sm:flex-row sm:items-center sm:justify-end sm:pl-4 sm:pr-3 " +
  // Buttons inside the footer take the mockup look without editing consumers.
  "[&_[data-slot=button]]:h-8 [&_[data-slot=button]]:rounded-[9px] [&_[data-slot=button]]:px-3 [&_[data-slot=button]]:text-sm [&_[data-slot=button]]:font-medium [&_[data-slot=button]]:shadow-none " +
  "[&_[data-slot=button][data-variant=outline]]:border-transparent [&_[data-slot=button][data-variant=outline]]:bg-transparent [&_[data-slot=button][data-variant=outline]]:text-ds-muted [&_[data-slot=button][data-variant=outline]:hover]:bg-ds-hover [&_[data-slot=button][data-variant=outline]:hover]:text-ds-ink " +
  "[&_[data-slot=button][data-variant=secondary]]:border-transparent [&_[data-slot=button][data-variant=secondary]]:bg-transparent [&_[data-slot=button][data-variant=secondary]]:text-ds-muted [&_[data-slot=button][data-variant=secondary]:hover]:bg-ds-hover [&_[data-slot=button][data-variant=secondary]:hover]:text-ds-ink " +
  "[&_[data-slot=button][data-variant=ghost]]:text-ds-muted [&_[data-slot=button][data-variant=ghost]:hover]:bg-ds-hover [&_[data-slot=button][data-variant=ghost]:hover]:text-ds-ink " +
  "[&_[data-slot=button][data-variant=default]]:bg-ds-accent [&_[data-slot=button][data-variant=default]]:text-white [&_[data-slot=button][data-variant=default]:hover]:bg-ds-accent/90 " +
  "[&_[data-slot=button][data-variant=destructive]]:bg-ds-bad [&_[data-slot=button][data-variant=destructive]]:text-white [&_[data-slot=button][data-variant=destructive]:hover]:bg-ds-bad/90";

/** The small translucent key hint inside a primary button ("↵", "⌘↵"). */
export const DIALOG_KEY_HINT =
  "ml-1 -mr-1 inline-grid h-5 min-w-5 place-items-center rounded-[5px] bg-white/20 px-1 text-[11px] font-medium";

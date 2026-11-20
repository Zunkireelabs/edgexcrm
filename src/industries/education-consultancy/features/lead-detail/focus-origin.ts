/**
 * Focus return for the page's dialogs (EDGEX-155 requirement 9). Radix only returns focus to a `<DialogTrigger>`, and these
 * dialogs are opened from buttons, menus and chains (gate → confirm, Edit profile → Discard), so the page remembers the ORIGINAL
 * trigger when a flow starts and every dialog hands focus back to it on close.
 *
 *  - Call `rememberOrigin()` where the flow starts (the clicked button is `document.activeElement`), or
 *    `rememberOrigin(menuTriggerButton)` when the click was on a menu item, because the menu's content is gone by then.
 *  - Give each dialog content `onCloseAutoFocus={restoreOrigin}`.
 * Closing one dialog of a chain while another opens (or is still open) leaves focus alone; the last close restores it.
 */
let origin: HTMLElement | null = null;

export function rememberOrigin(el?: Element | null): void {
  const target = (el ?? (typeof document !== "undefined" ? document.activeElement : null)) as HTMLElement | null;
  origin = target && target !== document.body ? target : null;
}

const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/** `onCloseAutoFocus` handler: cancels Radix's own (trigger-less) restore and focuses the remembered trigger. */
export function restoreOrigin(e?: Event): void {
  e?.preventDefault();
  const el = origin;
  setTimeout(() => {
    if (!el || !el.isConnected || document.querySelector(OPEN_LAYER)) return;
    el.focus();
  }, 0);
}

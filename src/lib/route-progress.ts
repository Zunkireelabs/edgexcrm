/**
 * Pure logic behind the route-loading indicator (src/components/ui/route-progress.tsx).
 * DOM-free so it is unit-testable.
 *
 * The percentage is SIMULATED — Next does not report how far a page has rendered. It trickles
 * quickly toward PROGRESS_CAP and then holds there until the route has actually changed, so it
 * can never show 100% before the page is ready.
 */

/** The simulated progress never goes past this until the navigation really completes. */
export const PROGRESS_CAP = 90;

/** One tick of the trickle: fast at first, slowing as it nears the cap, monotonic, never above the cap. */
export function nextProgress(current: number): number {
  if (current >= PROGRESS_CAP) return PROGRESS_CAP;
  const step = Math.max(0.5, (PROGRESS_CAP - current) * 0.08);
  return Math.min(PROGRESS_CAP, current + step);
}

export interface ClickInput {
  /** MouseEvent.button — 0 is the primary (left) button. */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The closest `<a href>` to the click target, if any. */
  anchor: {
    /** The raw `href` attribute (may be relative). */
    href: string;
    target: string | null;
    hasDownload: boolean;
    /** `data-no-progress` present — lets any link opt out. */
    optOut: boolean;
  } | null;
}

/**
 * Should this click start the loading indicator? Only a plain left-click on an internal link to a
 * DIFFERENT page (path or query). External links, new-tab/modified clicks, downloads, hash-only
 * jumps, and links to the page we're already on never start it.
 */
export function shouldStartForClick(input: ClickInput, currentHref: string): boolean {
  const { anchor } = input;
  if (!anchor) return false;
  if (input.button !== 0) return false;
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) return false;
  if (anchor.optOut || anchor.hasDownload) return false;
  if (anchor.target && anchor.target !== "_self") return false;

  let current: URL;
  let next: URL;
  try {
    current = new URL(currentHref);
    next = new URL(anchor.href, current);
  } catch {
    return false;
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") return false; // mailto:, tel:, javascript:
  if (next.origin !== current.origin) return false;
  // Same page (this also covers hash-only jumps) — nothing will load.
  return next.pathname !== current.pathname || next.search !== current.search;
}

"use client";

import type { ReactNode } from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

interface SidebarFlyoutProps {
  /** Small uppercase heading shown at the top of the flyout (the group's name). */
  header: string;
  /** The collapsed icon link — must be a single element that accepts a ref + props (a `<Link>` or `<button>`). */
  trigger: ReactNode;
  /** The flyout's links. */
  children: ReactNode;
}

/**
 * Hover flyout for a collapsed-sidebar group icon. Rendered through a portal on purpose: the nav list is a scroll
 * container (`overflow-y-auto overflow-x-hidden`), which clips anything absolutely positioned past the 68px sidebar —
 * a CSS `group-hover` flyout inside it got cut off at the sidebar edge. The portal escapes that clipping and sits above
 * the page content. Opens instantly, closes after a short grace so the pointer can travel from the icon to the flyout.
 */
export function SidebarFlyout({ header, trigger, children }: SidebarFlyoutProps) {
  return (
    <HoverCardPrimitive.Root openDelay={0} closeDelay={80}>
      <HoverCardPrimitive.Trigger asChild>{trigger}</HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="right"
          align="start"
          sideOffset={4}
          className="z-[100] min-w-[190px] bg-white rounded-lg shadow-lg border border-gray-200 py-1.5 outline-none"
        >
          <p className="px-3 pb-1 text-[11px] font-medium text-gray-400 uppercase tracking-wider select-none">{header}</p>
          {children}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

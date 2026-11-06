"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarFlyoutProps {
  /** The item's name, shown as the card's title row. */
  title: string;
  /** The collapsed-rail icon button — a single element that accepts a ref + props. */
  trigger: ReactNode;
  /** Optional instant tooltip on the rail icon (needs the sidebar's TooltipProvider above). */
  tip?: string;
  /** The sub-links. Any link/button inside closes the flyout on click. */
  children: ReactNode;
}

/**
 * Click flyout for a collapsed-rail item that has sub-pages (EDGEX-86 §9). A 200px card to the
 * right of the rail: the item's name, then its sub-links. Closes on outside click, Escape and
 * navigation. Rendered through a portal on purpose: the nav list is a scroll container
 * (`overflow-x-hidden`) that would clip anything positioned past the 68px rail.
 */
export function SidebarFlyout({ title, trigger, tip, children }: SidebarFlyoutProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {tip ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8} className="z-[100] !animate-none">
            {tip}
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      )}
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a,button")) setOpen(false);
          }}
          className="z-[100] w-[200px] rounded-ds-md border border-ds-border bg-ds-surface p-1.5 shadow-[var(--ds-shadow-float)] outline-none"
        >
          <p className="select-none px-2 pb-1.5 pt-1 text-xs font-medium text-ds-faint">{title}</p>
          <div className="flex flex-col gap-px">{children}</div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

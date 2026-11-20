"use client";

// Phone bottom sheet (EDGEX-141 Phase 5, temp_ss/applications-phone-v1.html `.sheet`): the container
// a desktop popover switches to below md. Same Radix Dialog primitive as ui/sheet.tsx; only the
// shell is new: r16 top corners, grab handle, title row with ✕, max 78% height, closes on a scrim
// tap, Escape, ✕ or a swipe down on the handle/title.
//
// The body restyles the shared popover content it hosts (filter panels, list pickers) with
// descendant selectors only, so that content keeps one code path: 44px rows, full-width lists,
// no inner 320px cap, a boxed 40px search row that stays pinned while the list scrolls.

import { createContext, useContext, useRef, type ReactNode } from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { XIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Descendant overrides that turn popover menus (32px ITEM rows, POP_SEARCH) into sheet rows. */
export const SHEET_BODY_OVERRIDES = [
  // 44px rows, 10px radius, 14px text (`.mi`)
  "[&_[role=option]]:h-11 [&_[role=option]]:rounded-[10px] [&_[role=option]]:px-2.5 [&_[role=option]]:text-[14px]",
  // lists take the sheet's width and let the sheet scroll
  "[&_[role=listbox]]:!w-full [&_[role=listbox]]:max-h-none [&_[role=listbox]>div]:max-h-none",
  // the search row (`.ssearch`): 40px boxed field, pinned to the top of the scrolling body
  "[&_[role=listbox]>div:has(>input)]:sticky [&_[role=listbox]>div:has(>input)]:top-0 [&_[role=listbox]>div:has(>input)]:z-10",
  "[&_[role=listbox]>div:has(>input)]:mx-0 [&_[role=listbox]>div:has(>input)]:mt-0 [&_[role=listbox]>div:has(>input)]:mb-1.5",
  "[&_[role=listbox]>div:has(>input)]:h-10 [&_[role=listbox]>div:has(>input)]:rounded-[10px] [&_[role=listbox]>div:has(>input)]:border-b-0",
  "[&_[role=listbox]>div:has(>input)]:bg-ds-surface [&_[role=listbox]>div:has(>input)]:shadow-[inset_0_0_0_1px_var(--ds-border)]",
].join(" ");

const SWIPE_CLOSE_PX = 80;

/** True inside a BottomSheet: hosted search inputs must not auto-focus (it pops the phone keyboard). */
const InSheetContext = createContext(false);
export function useInSheet(): boolean {
  return useContext(InSheetContext);
}

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Muted line under the title ("Sita Gurung · University of East London"). */
  subtitle?: ReactNode;
  /** Left of the title (a back arrow on a second screen). */
  leading?: ReactNode;
  children: ReactNode;
  testId?: string;
  /** Extra classes on the scrolling body. */
  bodyClassName?: string;
  /** Turn hosted popover rows into 44px sheet rows (default on). */
  sheetRows?: boolean;
}

export function BottomSheet({ open, onOpenChange, title, subtitle, leading, children, testId, bodyClassName, sheetRows = true }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);

  function setOffset(dy: number, animate: boolean) {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms ease-out" : "none";
    el.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  }

  // Swipe down on the handle / title row: follow the finger, close past 80px, else spring back.
  const swipe = {
    onPointerDown(e: React.PointerEvent) {
      drag.current = { y: e.clientY, dy: 0 };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent) {
      if (!drag.current) return;
      drag.current.dy = Math.max(0, e.clientY - drag.current.y);
      setOffset(drag.current.dy, false);
    },
    onPointerUp() {
      const dy = drag.current?.dy ?? 0;
      drag.current = null;
      if (dy > SWIPE_CLOSE_PX) onOpenChange(false);
      else setOffset(0, true);
    },
    onPointerCancel() {
      drag.current = null;
      setOffset(0, true);
    },
  };

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal>
        <SheetPrimitive.Overlay
          data-testid={testId ? `${testId}-scrim` : undefined}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(16,17,18,.32)]"
        />
        <SheetPrimitive.Content
          ref={panelRef}
          data-testid={testId}
          onOpenAutoFocus={(e) => {
            // Don't pop the phone keyboard over a sheet: focus the panel, not its search input.
            e.preventDefault();
            panelRef.current?.focus();
          }}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[78dvh] flex-col rounded-t-[16px] bg-ds-surface pb-[max(22px,env(safe-area-inset-bottom))] text-sm font-medium text-ds-ink shadow-[0_10px_15px_-3px_rgb(0_0_0/.1),0_4px_6px_-4px_rgb(0_0_0/.1),0_0_0_1px_rgba(0,0,0,.06)] outline-none data-[state=closed]:duration-200 data-[state=open]:duration-300"
        >
          <div className="shrink-0 touch-none select-none" {...swipe} data-testid={testId ? `${testId}-grab` : undefined}>
            <div aria-hidden="true" className="mx-auto mt-2 mb-1 h-1 w-9 rounded-full bg-ds-ghost" />
            <div className="flex items-center gap-2 pt-1.5 pr-2 pb-2 pl-4">
              {leading && (
                <span className="contents" onPointerDown={(e) => e.stopPropagation()}>
                  {leading}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <SheetPrimitive.Title className="truncate text-[16px] font-semibold text-ds-ink">{title}</SheetPrimitive.Title>
                {subtitle ? (
                  <SheetPrimitive.Description className="truncate text-[12px] font-normal text-ds-muted">{subtitle}</SheetPrimitive.Description>
                ) : (
                  <SheetPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Options"}</SheetPrimitive.Description>
                )}
              </div>
              <SheetPrimitive.Close
                aria-label="Close"
                data-testid={testId ? `${testId}-close` : undefined}
                onPointerDown={(e) => e.stopPropagation()}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ds-text hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost"
              >
                <XIcon className="size-[15px]" />
              </SheetPrimitive.Close>
            </div>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-2", sheetRows && SHEET_BODY_OVERRIDES, bodyClassName)}>
            <InSheetContext.Provider value={true}>{children}</InSheetContext.Provider>
          </div>
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}

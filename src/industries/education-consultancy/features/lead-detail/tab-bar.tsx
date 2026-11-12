"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CaretDownIcon } from "@/components/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CountChip } from "../record-preview/parts";
import { TAB_GAP, visibleTabCount, type TabId } from "./lib/tabs";

export interface TabDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  count?: number | null;
  /** Amber hint instead of a count (e.g. "2 left" on Consent & fee). */
  hint?: string | null;
}

/** Tab box exactly like the record preview's: 28px, padding 4 8, radius 8, active #fbfbfb + inset ring, 1px ink underline. */
const TAB = "relative flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] px-2 py-1 text-[14px] font-medium leading-5 shadow-[inset_0_0_0_1px_transparent] outline-none transition-[box-shadow,background-color] duration-[140ms] focus-visible:ring-2 focus-visible:ring-[#266df0]/50 [&_svg]:size-4";
const TAB_IDLE = "text-black/[.63] hover:text-[#101112] hover:shadow-[inset_0_0_0_1px_#eeeff1]";
const TAB_ON = "bg-[#fbfbfb] text-[#101112] shadow-[inset_0_0_0_1px_#eeeff1] after:absolute after:inset-x-0 after:-bottom-[8px] after:h-px after:bg-[#101112]";

export function tabId(id: TabId): string { return `lead-tab-${id}`; }
export const PANEL_ID = "lead-tabpanel";

function Hint({ children }: { children: ReactNode }) {
  return <span className="rounded-[4px] bg-[#fdf3e3] px-[5px] text-[11px] font-medium leading-4 text-[#b25e09]">{children}</span>;
}

function Badge({ t }: { t: TabDef }) {
  if (t.hint) return <Hint>{t.hint}</Hint>;
  return t.count !== undefined && t.count !== null ? <CountChip>{t.count}</CountChip> : null;
}

/**
 * `scroll` (phone): ONE row of every tab that scrolls sideways inside itself: no measuring and no "+N more". The active tab is
 * scrolled into view whenever it changes.
 */
export function TabBar({ tabs, active, onSelect, scroll = false }: { tabs: TabDef[]; active: TabId; onSelect: (id: TabId) => void; scroll?: boolean }) {
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(tabs.length);

  const measure = useCallback(() => {
    const nav = navRef.current;
    const m = measureRef.current;
    if (!nav || !m) return;
    const kids = Array.from(m.querySelectorAll<HTMLElement>("[data-measure-tab]"));
    const widths = kids.map((k) => k.offsetWidth);
    const more = m.querySelector<HTMLElement>("[data-measure-more]")?.offsetWidth ?? 80;
    const cs = getComputedStyle(nav);
    const available = nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    // jsdom / not laid out yet: show everything rather than collapsing to one tab.
    setVisible(available > 0 && widths.some((w) => w > 0) ? visibleTabCount(widths, available, more) : widths.length);
  }, []);

  // Re-measure when the row resizes and whenever the tab set / counts change (they change the natural widths).
  // (A ResizeObserver reports once when it starts observing, which is the first measurement.)
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(nav);
    if (measureRef.current) ro.observe(measureRef.current);
    return () => ro.disconnect();
  }, [measure, tabs]);

  useEffect(() => {
    if (!scroll) return;
    document.getElementById(tabId(active))?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [scroll, active]);

  const shown = scroll ? tabs : tabs.slice(0, visible);
  const hidden = scroll ? [] : tabs.slice(visible);
  const activeHidden = hidden.some((t) => t.id === active);

  const focusTab = (id: TabId) => document.getElementById(tabId(id))?.focus();
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = shown.findIndex((t) => t.id === active);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % shown.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + shown.length) % shown.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = shown.length - 1;
    if (next === null || shown.length === 0) return;
    e.preventDefault();
    const t = shown[next];
    onSelect(t.id);
    focusTab(t.id);
  };

  return (
    <nav
      ref={navRef} data-scroll={scroll ? "true" : undefined}
      className={cn("relative flex h-11 flex-none items-start border-b border-[#e8e9eb] px-3 pt-2", scroll && "overflow-x-auto overflow-y-hidden px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
      style={{ gap: TAB_GAP }}
    >
      <div role="tablist" aria-label="Lead sections" onKeyDown={onKeyDown} className={cn("flex items-start", scroll && "flex-none")} style={{ gap: TAB_GAP }}>
        {shown.map((t) => (
          <button
            key={t.id} id={tabId(t.id)} type="button" role="tab" aria-selected={active === t.id} aria-controls={PANEL_ID}
            tabIndex={active === t.id || (activeHidden && t.id === shown[0]?.id) ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={cn(TAB, active === t.id ? TAB_ON : TAB_IDLE)}
          >
            {t.icon}{t.label}<Badge t={t} />
          </button>
        ))}
      </div>

      {hidden.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`${hidden.length} more tabs`}
            className={cn(TAB, activeHidden ? TAB_ON : TAB_IDLE, "data-[state=open]:text-[#101112] data-[state=open]:shadow-[inset_0_0_0_1px_#eeeff1]")}
          >
            +{hidden.length} more<CaretDownIcon className="!size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px] rounded-[12px] p-1">
            {hidden.map((t) => (
              <DropdownMenuItem
                key={t.id} onSelect={() => onSelect(t.id)} aria-current={active === t.id ? "page" : undefined}
                className={cn("h-8 gap-2 rounded-[8px] px-2 text-[14px] font-medium [&_svg]:size-4 [&_svg]:text-[#6b6f76]", active === t.id && "bg-[#f6f7f9]")}
              >
                {t.icon}{t.label}
                <span className="ml-auto"><Badge t={t} /></span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Off-screen copy of every tab at natural width: this is what gets measured (not needed when the row scrolls). */}
      {!scroll && <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 overflow-hidden" style={{ gap: TAB_GAP }}>
        {tabs.map((t) => (
          <span key={t.id} data-measure-tab className={cn(TAB, TAB_IDLE)}>{t.icon}{t.label}<Badge t={t} /></span>
        ))}
        <span data-measure-more className={cn(TAB, TAB_IDLE)}>+{Math.max(1, tabs.length - 4)} more<CaretDownIcon className="!size-3" /></span>
      </div>}
    </nav>
  );
}

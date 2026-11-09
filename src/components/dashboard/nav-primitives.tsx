"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SidebarTip } from "@/components/dashboard/sidebar-tooltip";
import { SidebarFlyout } from "@/components/dashboard/sidebar-flyout";
import { CaretDownIcon, SlidersHorizontalIcon, type Icon } from "@/components/dashboard/shell-icons";

/** Shell icon rule (EDGEX-129, Attio-measured): Phosphor regular, 16px, text grey; the active item goes ink, same weight, no fill. */
export function NavIcon({ icon: IconCmp, active = false }: { icon: Icon; active?: boolean }) {
  return (
    <IconCmp
      size={16}
      weight="regular"
      aria-hidden
      className={cn("shrink-0", active ? "text-ds-ink" : "text-ds-text")}
    />
  );
}

/** Sidebar count pill (EDGEX-129, Attio-measured): 16px blue pill, 12px/500 white tabular. Callers cap at "9+". */
export function NavCountPill({ children }: { children: ReactNode }) {
  return (
    <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-md bg-ds-accent px-1 text-xs font-medium leading-4 tabular-nums text-white">
      {children}
    </span>
  );
}

// Row classes keep colour OUT of the base string and pick idle vs active explicitly, so no text/bg
// class ever depends on tailwind-merge resolving two competing `text-ds-*` colours. shrink-0: rows keep
// their height when the nav overflows (the nav scrolls instead).
// EDGEX-129 (Attio-measured): 28px rows on a 29px pitch (the nav's gap-px), 9px radius, 14px/500 ink with -0.07px
// tracking, 6px icon gap, 8px/4px side padding. Hover and active share one fill, --sidebar-row-hover.
export const NAV_ROW =
  "flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[9px] pl-2 pr-1 text-sm font-medium leading-5 tracking-[-0.07px] transition-colors";
export const NAV_ROW_IDLE = "text-ds-ink hover:bg-[var(--sidebar-row-hover)]";
export const NAV_ROW_ACTIVE = "bg-[var(--sidebar-row-hover)] text-ds-ink";
export const navRowTone = (active: boolean) => (active ? NAV_ROW_ACTIVE : NAV_ROW_IDLE);
export const NAV_ROW_COLLAPSED = "justify-center px-0";
const SUB_ROW = "flex h-7 w-full shrink-0 items-center rounded-[9px] px-2 text-sm font-medium leading-5 tracking-[-0.07px] transition-colors";
const SUB_IDLE = "text-ds-muted hover:bg-[var(--sidebar-row-hover)] hover:text-ds-ink";
const SUB_ACTIVE = "bg-[var(--sidebar-row-hover)] text-ds-ink";
const SUB_ACTION = "gap-2 text-[13px] text-ds-faint hover:bg-[var(--sidebar-row-hover)] hover:text-ds-muted";
const subTone = (active: boolean) => (active ? SUB_ACTIVE : SUB_IDLE);

/** A foldable group (EDGEX-86 §3). In the collapsed rail the header becomes a 24px divider and nothing folds. */
export function NavGroup({
  label,
  open,
  onToggle,
  collapsed,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  collapsed?: boolean;
  children: ReactNode;
}) {
  if (collapsed) {
    return (
      <>
        <div aria-hidden className="mx-auto my-[7px] h-px w-6 shrink-0 bg-ds-border" />
        {children}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="mt-3 flex h-7 w-full shrink-0 select-none items-center gap-1.5 px-2 text-xs font-medium leading-4 text-ds-muted hover:text-ds-ink"
      >
        <CaretDownIcon
          size={12}
          aria-hidden
          className={cn("shrink-0 text-ds-faint transition-transform", !open && "-rotate-90")}
        />
        {label}
      </button>
      {open && children}
    </>
  );
}

export interface NavSubLink {
  key: string;
  href: string;
  label: string;
  active: boolean;
  /** Stage colour dot shown before the label (leads stage tree). */
  dotColor?: string;
}

/** One child row of the tree: a tick off the guide line, an optional 6px stage dot, then the label. */
const TREE_ROW =
  "relative gap-2 pl-[18px] pr-2 before:absolute before:left-0 before:top-1/2 before:h-px before:w-2.5 before:bg-ds-border";
function TreeDot({ color }: { color?: string }) {
  return color ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : null;
}

interface NavExpandableProps {
  icon: Icon;
  label: string;
  collapsed?: boolean;
  onNavigate: () => void;
  /** The parent row's own page. Omit for a row that only expands (Archive, industry groups). */
  href?: string;
  parentActive?: boolean;
  hasActiveChild?: boolean;
  links: NavSubLink[];
  /** A trailing quiet action row, e.g. "Manage stages". */
  action?: { label: string; onClick: () => void };
}

/**
 * An item with sub-pages: All leads (stages), Organise, Archive, it_agency's lead groups.
 * Expanded sidebar: the row plus a chevron that folds a bordered sub-list.
 * Collapsed rail: an icon that opens a click flyout (EDGEX-86 §9).
 */
export function NavExpandable({
  icon,
  label,
  collapsed = false,
  onNavigate,
  href,
  parentActive = false,
  hasActiveChild = false,
  links,
  action,
}: NavExpandableProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasActiveChild) setExpanded(true);
  }, [hasActiveChild]);

  const highlighted = parentActive || (!href && hasActiveChild);
  const canExpand = links.length > 0 || !!action;

  if (collapsed) {
    const iconTrigger = (
      <button
        type="button"
        aria-label={label}
        className={cn(
          NAV_ROW,
          NAV_ROW_COLLAPSED,
          navRowTone(highlighted || hasActiveChild),
          "data-[state=open]:bg-ds-hover data-[state=open]:text-ds-ink",
        )}
      >
        <NavIcon icon={icon} active={highlighted || hasActiveChild} />
      </button>
    );
    if (!canExpand && href) {
      return (
        <SidebarTip label={label}>
          <Link
            href={href}
            onClick={onNavigate}
            aria-label={label}
            className={cn(NAV_ROW, NAV_ROW_COLLAPSED, navRowTone(parentActive))}
          >
            <NavIcon icon={icon} active={parentActive} />
          </Link>
        </SidebarTip>
      );
    }
    return (
      <SidebarFlyout title={label} tip={label} trigger={iconTrigger}>
        {href && (
          <Link
            href={href}
            onClick={onNavigate}
            className={cn(SUB_ROW, "h-[30px] font-medium", subTone(parentActive))}
          >
            {label}
          </Link>
        )}
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            onClick={onNavigate}
            className={cn(SUB_ROW, "h-[30px] gap-2", subTone(l.active))}
          >
            <TreeDot color={l.dotColor} />
            <span className="ml-0 truncate">{l.label}</span>
          </Link>
        ))}
        {action && (
          <button
            type="button"
            onClick={() => {
              onNavigate();
              action.onClick();
            }}
            className={cn(SUB_ROW, "h-[30px]", SUB_ACTION)}
          >
            {action.label}
          </button>
        )}
      </SidebarFlyout>
    );
  }

  const chevron = (
    <CaretDownIcon
      size={14}
      aria-hidden
      className={cn("shrink-0 text-ds-faint transition-transform", expanded && "rotate-180")}
    />
  );

  return (
    <div>
      {href ? (
        <div className={cn(NAV_ROW, "group/row gap-0 px-0", navRowTone(parentActive))}>
          <Link href={href} onClick={onNavigate} className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2">
            <NavIcon icon={icon} active={parentActive} />
            <span className="truncate">{label}</span>
          </Link>
          {canExpand && (
            // Quiet 20px toggle: only on row hover/focus (always shown on touch, where there is no hover).
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
              onClick={() => setExpanded((v) => !v)}
              className="mr-1 grid size-5 shrink-0 place-items-center rounded-md opacity-0 transition-opacity hover:bg-black/[.06] focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
            >
              {chevron}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cn(NAV_ROW, highlighted ? "text-ds-ink hover:bg-[var(--sidebar-row-hover)]" : NAV_ROW_IDLE)}
        >
          <NavIcon icon={icon} active={highlighted} />
          <span className="flex-1 truncate text-left">{label}</span>
          {chevron}
        </button>
      )}
      {expanded && canExpand && (
        <div className="relative mb-1 ml-[15px] mt-px shrink-0 before:absolute before:bottom-3.5 before:left-0 before:top-0 before:w-px before:bg-ds-border">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              onClick={onNavigate}
              className={cn(SUB_ROW, TREE_ROW, "mb-px", subTone(l.active))}
            >
              <TreeDot color={l.dotColor} />
              <span className="truncate">{l.label}</span>
            </Link>
          ))}
          {action && (
            <button
              type="button"
              onClick={() => {
                onNavigate();
                action.onClick();
              }}
              className={cn(SUB_ROW, TREE_ROW, SUB_ACTION)}
            >
              <SlidersHorizontalIcon size={14} aria-hidden className="shrink-0" />
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

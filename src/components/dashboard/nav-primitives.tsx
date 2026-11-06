"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SidebarTip } from "@/components/dashboard/sidebar-tooltip";
import { SidebarFlyout } from "@/components/dashboard/sidebar-flyout";
import { CaretDownIcon, type Icon } from "@/components/dashboard/shell-icons";

/** Shell icon rule (EDGEX-86 §1): Phosphor regular, 18px, muted; the active item goes ink, same weight, no fill. */
export function NavIcon({ icon: IconCmp, active = false }: { icon: Icon; active?: boolean }) {
  return (
    <IconCmp
      size={18}
      weight="regular"
      aria-hidden
      className={cn("shrink-0", active ? "text-ds-ink" : "text-ds-muted")}
    />
  );
}

// Row classes keep colour OUT of the base string and pick idle vs active explicitly, so no text/bg
// class ever depends on tailwind-merge resolving two competing `text-ds-*` colours. shrink-0: rows keep
// their height when the nav overflows (the nav scrolls instead).
export const NAV_ROW =
  "flex h-8 w-full shrink-0 items-center gap-2.5 rounded-ds-sm px-2 text-[13.5px] font-medium transition-colors";
export const NAV_ROW_IDLE = "text-ds-text hover:bg-ds-hover";
export const NAV_ROW_ACTIVE = "bg-ds-selected font-medium text-ds-ink hover:bg-ds-selected";
export const navRowTone = (active: boolean) => (active ? NAV_ROW_ACTIVE : NAV_ROW_IDLE);
export const NAV_ROW_COLLAPSED = "justify-center px-0";
const SUB_ROW = "flex h-7 w-full shrink-0 items-center rounded-ds-sm px-2 text-[13px] transition-colors";
const SUB_IDLE = "text-ds-muted hover:bg-ds-hover";
const SUB_ACTIVE = "bg-ds-selected font-medium text-ds-ink hover:bg-ds-selected";
const SUB_ACTION = "text-[12.5px] text-ds-faint hover:bg-ds-hover hover:text-ds-muted";
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
        className="flex w-full shrink-0 select-none items-center justify-between px-2 pb-1 pt-3.5 text-xs font-medium text-ds-muted hover:text-ds-ink"
      >
        {label}
        <CaretDownIcon
          size={14}
          aria-hidden
          className={cn("text-ds-ghost transition-transform", !open && "-rotate-90")}
        />
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
            className={cn(SUB_ROW, "h-[30px] font-medium", subTone(l.active))}
          >
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
      className={cn("shrink-0 text-ds-ghost transition-transform", expanded && "rotate-180")}
    />
  );

  return (
    <div>
      {href ? (
        <div className={cn(NAV_ROW, "gap-0 px-0", navRowTone(parentActive))}>
          <Link href={href} onClick={onNavigate} className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2">
            <NavIcon icon={icon} active={parentActive} />
            <span className="truncate">{label}</span>
          </Link>
          {canExpand && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
              onClick={() => setExpanded((v) => !v)}
              className="flex h-full items-center px-2"
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
          className={cn(NAV_ROW, highlighted ? "text-ds-ink hover:bg-ds-hover" : NAV_ROW_IDLE)}
        >
          <NavIcon icon={icon} active={highlighted} />
          <span className="flex-1 truncate text-left">{label}</span>
          {chevron}
        </button>
      )}
      {expanded && canExpand && (
        <div className="mb-1 ml-[15px] mt-px shrink-0 border-l border-ds-border pl-3">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              onClick={onNavigate}
              className={cn(SUB_ROW, subTone(l.active))}
            >
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
              className={cn(SUB_ROW, SUB_ACTION)}
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

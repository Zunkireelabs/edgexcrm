"use client";

// The v2 leads grid (EDGEX-117): header, rows, summary footer and filler column. Pure presentation:
// every piece of state (selection, sort, preferences, data) and every handler lives in
// leads-table.tsx and arrives as props. Bulk bar and pagination are siblings, not children.

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, PushPinIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import type { Lead } from "@/types/database";
import type { LeadColumn, LeadColumnCtx } from "../columns-registry";
import type { SortDirection } from "../toolbar/view-state";
import { ColumnHeaderMenu, type ColumnMenuModel } from "./column-header-menu";
import {
  CHECKBOX_WIDTH,
  DEFAULT_COLUMN_WIDTH,
  canMove,
  canPin,
  hideColumn,
  moveColumn,
  pinColumn,
  stickyOffsets,
  unpinColumn,
  type ColumnLayout,
} from "./grid-layout";
import { FALLBACK_COLUMN_ICON, legacyCellContent } from "./v2-columns";

export const NAME_DEFAULT_WIDTH = 210;

// Mockup checkbox: 16px, 5px radius, 1.5px ghost inset border, accent fill when checked.
const CHECKBOX_CLASS =
  "size-4 rounded-[5px] border-0 bg-ds-surface shadow-[inset_0_0_0_1.5px_var(--ds-ghost)] dark:bg-ds-surface data-[state=checked]:bg-ds-accent data-[state=checked]:text-white data-[state=checked]:shadow-none data-[state=indeterminate]:bg-ds-accent data-[state=indeterminate]:text-white data-[state=indeterminate]:shadow-none";
// Stronger divider after Name (border plus inset shadow, as .sn in the mockup).
const NAME_EDGE = "border-r border-ds-border";
const MIN_WIDTH = 60;

/** Counsellors summary: facet options with leads, excluding Unassigned. Null when the facet is not available. */
export function countCounsellors(facet: { name: string; count: number }[] | null | undefined): number | null {
  if (!facet) return null;
  return facet.filter((o) => o.count > 0 && o.name !== "unassigned").length;
}

export interface LeadsGridProps {
  leads: Lead[];
  /** Name column, then the visible middle columns in display order (each carries a `v2` block). */
  nameColumn: LeadColumn;
  columns: LeadColumn[];
  ctx: LeadColumnCtx;
  layout: ColumnLayout;
  widths: Record<string, number>;
  labels: Record<string, string>;
  onWidthChange: (key: string, width: number) => void;
  onWidthCommit: () => void;
  onLayoutChange: (next: ColumnLayout) => void;
  onRename: (key: string, label: string | null) => void;
  selectedIds: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  sort: { field: string; direction: SortDirection };
  onSort: (sortKey: string, direction: SortDirection) => void;
  /** Filter registry keys the user may filter on (role-hidden fields are absent). */
  filterFieldKeys: Set<string>;
  onFilterRequest: (fieldKey: string) => void;
  /** Total matching leads (server total) and the counsellor count, for the footer. */
  total: number;
  counsellors: number | null;
  loading: boolean;
  /** Rendered instead of the table + footer when there are no rows and nothing is loading. */
  emptyState: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const CELL_BASE = "h-9 overflow-hidden whitespace-nowrap px-3 align-middle shadow-[inset_-1px_0_0_var(--ds-border)] border-b border-ds-border";
const HEAD_BASE = "h-[38px] p-0 align-middle shadow-[inset_-1px_0_0_var(--ds-border)] border-b border-ds-border bg-ds-surface text-left";

interface RowProps {
  lead: Lead;
  nameColumn: LeadColumn;
  columns: LeadColumn[];
  ctx: LeadColumnCtx;
  selected: boolean;
  anySelected: boolean;
  stickyLeft: Map<string, number>;
  onToggleSelect: (id: string) => void;
  hoveredRowRef: React.MutableRefObject<string | null>;
}

const Row = memo(function Row({ lead, nameColumn, columns, ctx, selected, anySelected, stickyLeft, onToggleSelect, hoveredRowRef }: RowProps) {
  const bg = selected ? "bg-ds-accent-soft" : "bg-ds-surface group-hover/row:bg-ds-hover";
  const all = [nameColumn, ...columns];
  return (
    <tr
      className="group/row h-9"
      onMouseEnter={() => {
        hoveredRowRef.current = lead.id;
      }}
      onMouseLeave={() => {
        if (hoveredRowRef.current === lead.id) hoveredRowRef.current = null;
      }}
      data-state={selected ? "selected" : undefined}
    >
      <td className={`${CELL_BASE} sticky left-0 z-10 px-0 ${bg}`} onClick={(e) => e.stopPropagation()}>
        <span className={`flex h-full items-center justify-center transition-opacity ${anySelected || selected ? "opacity-100" : "opacity-55 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100"}`}>
          <Checkbox
            className={CHECKBOX_CLASS}
            checked={selected}
            onCheckedChange={() => onToggleSelect(lead.id)}
            aria-label={`Select ${lead.first_name} ${lead.last_name}`}
          />
        </span>
      </td>
      {all.map((col) => {
        const isName = col.key === "name";
        const left = stickyLeft.get(col.key);
        const sticky = left !== undefined;
        const content = col.v2?.cell ? { content: col.v2.cell(lead, ctx), onClick: undefined } : legacyCellContent(col, lead, ctx);
        return (
          <td
            key={col.key}
            onClick={content.onClick}
            style={sticky ? ({ left } as CSSProperties) : undefined}
            className={`${CELL_BASE} ${bg} ${isName ? `relative ${NAME_EDGE}` : ""} text-ds-ink ${sticky ? "sticky z-10" : ""}`}
          >
            {content.content}
          </td>
        );
      })}
      <td className="h-9 border-b border-ds-border bg-ds-surface p-0 group-hover/row:bg-ds-hover" aria-hidden />
    </tr>
  );
});

export function LeadsGrid(props: LeadsGridProps) {
  const {
    leads,
    nameColumn,
    columns,
    ctx,
    layout,
    widths,
    labels,
    onWidthChange,
    onWidthCommit,
    onLayoutChange,
    onRename,
    selectedIds,
    allSelected,
    someSelected,
    onToggleSelect,
    onToggleSelectAll,
    sort,
    onSort,
    filterFieldKeys,
    onFilterRequest,
    total,
    counsellors,
    loading,
    emptyState,
  } = props;

  const hoveredRowRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  // Radix closes the menu on the outside pointerdown; the click that follows on the same header
  // would re-open it. Remember the key for a moment so that echo is swallowed.
  const justClosed = useRef<string | null>(null);

  const widthOf = useCallback((col: LeadColumn) => widths[col.key] ?? col.v2?.width ?? DEFAULT_COLUMN_WIDTH, [widths]);
  const titleOf = useCallback((col: LeadColumn) => labels[col.key] ?? col.v2?.label ?? col.label, [labels]);
  const defaultTitleOf = (col: LeadColumn) => col.v2?.label ?? col.label;

  // ⌘↵ / Ctrl+↵ opens the preview for the row under the pointer (ref, so rows never re-render on hover).
  const onPreviewToggle = ctx.onPreviewToggle;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || isTypingTarget(e.target)) return;
      const id = hoveredRowRef.current;
      if (!id) return;
      e.preventDefault();
      onPreviewToggle(id);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPreviewToggle]);

  // Drag-to-resize (min 60px). The handle never opens the column menu.
  const drag = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const startResize = useCallback((e: ReactMouseEvent<HTMLSpanElement>, key: string, current: number) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { key, startX: e.clientX, startWidth: current };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = drag.current;
      if (!d) return;
      onWidthChange(d.key, Math.max(MIN_WIDTH, Math.round(d.startWidth + e.clientX - d.startX)));
    }
    function onUp() {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onWidthCommit();
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onWidthChange, onWidthCommit]);

  // Sticky offsets: checkbox 0, Name, then pinned columns in order.
  const pinnedCols = useMemo(() => layout.pins.map((k) => columns.find((c) => c.key === k)).filter((c): c is LeadColumn => !!c), [layout.pins, columns]);
  const nameWidth = widths.name ?? nameColumn.v2?.width ?? NAME_DEFAULT_WIDTH;
  const stickyLeft = useMemo(() => {
    const offsets = stickyOffsets({ nameWidth, pinnedWidths: pinnedCols.map(widthOf) });
    const map = new Map<string, number>([["name", offsets[0]]]);
    pinnedCols.forEach((c, i) => map.set(c.key, offsets[i + 1]));
    return map;
  }, [nameWidth, pinnedCols, widthOf]);
  const pinnedSet = useMemo(() => new Set(layout.pins), [layout.pins]);

  const allCols = useMemo(() => [nameColumn, ...columns], [nameColumn, columns]);
  const totalWidth = CHECKBOX_WIDTH + allCols.reduce((n, c) => n + (c.key === "name" ? nameWidth : widthOf(c)), 0);
  const anySelected = selectedIds.size > 0;

  const menuCol = menu ? allCols.find((c) => c.key === menu.key) : undefined;
  const menuModel: ColumnMenuModel | null = menuCol
    ? {
        key: menuCol.key,
        title: titleOf(menuCol),
        defaultTitle: defaultTitleOf(menuCol),
        isName: menuCol.key === "name",
        sortKey: menuCol.v2?.sort,
        activeSortDirection: menuCol.v2?.sort && sort.field === menuCol.v2.sort ? sort.direction : null,
        canFilter: !!menuCol.v2?.filterFieldKey && filterFieldKeys.has(menuCol.v2.filterFieldKey),
        pinned: pinnedSet.has(menuCol.key),
        canPin: canPin(layout, menuCol.key),
        canMoveLeft: canMove(layout, menuCol.key, "left"),
        canMoveRight: canMove(layout, menuCol.key, "right"),
      }
    : null;

  function closeMenu() {
    if (menu) {
      const key = menu.key;
      justClosed.current = key;
      setTimeout(() => {
        if (justClosed.current === key) justClosed.current = null;
      }, 250);
    }
    setMenu(null);
  }

  function openMenu(col: LeadColumn, el: HTMLElement) {
    if (menu?.key === col.key) {
      closeMenu();
      return;
    }
    if (justClosed.current === col.key) return;
    setMenu({ key: col.key, anchor: el });
  }

  const empty = leads.length === 0 && !loading;
  if (empty) return <div className="flex min-h-0 flex-1 flex-col overflow-auto border-y border-ds-border bg-ds-surface">{emptyState}</div>;

  const sortedKey = (col: LeadColumn) => !!col.v2?.sort && sort.field === col.v2.sort;

  return (
    <div className="min-h-0 flex-1 overflow-auto border-t border-ds-border bg-ds-surface" data-testid="leads-grid-scroller">
      <table
        className="border-separate border-spacing-0 text-sm font-medium"
        style={{ tableLayout: "fixed", width: "100%", minWidth: totalWidth }}
        aria-rowcount={leads.length}
      >
        <colgroup>
          <col style={{ width: CHECKBOX_WIDTH }} />
          {allCols.map((c) => (
            <col key={c.key} style={{ width: c.key === "name" ? nameWidth : widthOf(c) }} />
          ))}
          <col />
        </colgroup>
        <thead>
          <tr>
            <th className={`${HEAD_BASE} sticky left-0 top-0 z-30`}>
              <span className="flex h-full items-center justify-center">
                <Checkbox
                  className={CHECKBOX_CLASS}
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={onToggleSelectAll}
                  aria-label="Select all"
                />
              </span>
            </th>
            {allCols.map((col) => {
              const isName = col.key === "name";
              const left = stickyLeft.get(col.key);
              const sticky = left !== undefined;
              const Icon = col.v2?.icon ?? FALLBACK_COLUMN_ICON;
              const sorted = sortedKey(col);
              const width = isName ? nameWidth : widthOf(col);
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  style={sticky ? ({ left } as CSSProperties) : undefined}
                  className={`${HEAD_BASE} group/th relative sticky top-0 ${isName ? NAME_EDGE : ""} ${sticky ? "z-30" : "z-20"}`}
                >
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menu?.key === col.key}
                    data-testid={`column-header-${col.key}`}
                    onClick={(e) => openMenu(col, e.currentTarget.parentElement as HTMLElement)}
                    className="flex h-full w-full items-center gap-2 px-3 text-left font-medium text-ds-muted transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ds-ghost"
                  >
                    {!isName && <Icon className="size-4 shrink-0 text-ds-faint" />}
                    <span className="min-w-0 flex-1 truncate text-ds-ink">{titleOf(col)}</span>
                    {isName ? (
                      <PushPinIcon className="size-3.5 shrink-0 text-ds-faint opacity-0 transition-opacity group-hover/th:opacity-100" />
                    ) : sorted ? (
                      sort.direction === "asc" ? (
                        <ArrowUpIcon className="size-3.5 shrink-0 text-ds-ink" />
                      ) : (
                        <ArrowDownIcon className="size-3.5 shrink-0 text-ds-ink" />
                      )
                    ) : (
                      <ArrowDownIcon className="size-3.5 shrink-0 text-ds-faint opacity-0 transition-opacity group-hover/th:opacity-100" />
                    )}
                  </button>
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(e) => startResize(e, col.key, width)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none hover:bg-ds-accent/40 active:bg-ds-accent/60"
                  />
                </th>
              );
            })}
            <th className="sticky top-0 z-20 h-[38px] border-b border-ds-border bg-ds-surface p-0" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {leads.length === 0
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="h-9" aria-hidden>
                  <td className={`${CELL_BASE} bg-ds-surface`} />
                  {allCols.map((c) => (
                    <td key={c.key} className={`${CELL_BASE} bg-ds-surface`}>
                      <span className="block h-2.5 w-3/5 animate-pulse rounded-full bg-ds-hover" />
                    </td>
                  ))}
                  <td className="h-9 border-b border-ds-border bg-ds-surface p-0" />
                </tr>
              ))
            : leads.map((lead) => (
                <Row
                  key={lead.id}
                  lead={lead}
                  nameColumn={nameColumn}
                  columns={columns}
                  ctx={ctx}
                  selected={selectedIds.has(lead.id)}
                  anySelected={anySelected}
                  stickyLeft={stickyLeft}
                  onToggleSelect={onToggleSelect}
                  hoveredRowRef={hoveredRowRef}
                />
              ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky bottom-0 left-0 z-30 h-9 border-t border-ds-border bg-ds-sunken p-0" />
            {allCols.map((col) => {
              const left = stickyLeft.get(col.key);
              const sticky = left !== undefined;
              let summary: ReactNode = null;
              if (col.key === "name") {
                summary = (
                  <>
                    <span className="font-medium text-ds-ink tabular-nums">{total.toLocaleString()}</span> {total === 1 ? "lead" : "leads"}
                  </>
                );
              } else if (col.key === "assigned" && counsellors !== null) {
                summary = (
                  <>
                    <span className="font-medium text-ds-ink tabular-nums">{counsellors.toLocaleString()}</span> {counsellors === 1 ? "counsellor" : "counsellors"}
                  </>
                );
              }
              return (
                <td
                  key={col.key}
                  style={sticky ? ({ left } as CSSProperties) : undefined}
                  className={`sticky bottom-0 ${col.key === "name" ? NAME_EDGE : ""} ${sticky ? "z-30" : "z-20"} h-9 overflow-hidden whitespace-nowrap border-t border-ds-border bg-ds-sunken px-3 text-[13px] font-normal text-ds-faint shadow-[inset_-1px_0_0_var(--ds-border)]`}
                >
                  {summary}
                </td>
              );
            })}
            <td className="sticky bottom-0 z-20 h-9 border-t border-ds-border bg-ds-sunken p-0" aria-hidden />
          </tr>
        </tfoot>
      </table>
      {menu && menuModel && menuCol && (
        <ColumnHeaderMenu
          key={menu.key}
          anchor={menu.anchor}
          model={menuModel}
          onClose={closeMenu}
          onSort={onSort}
          onFilter={() => menuCol.v2?.filterFieldKey && onFilterRequest(menuCol.v2.filterFieldKey)}
          onTogglePin={() => onLayoutChange(menuModel.pinned ? unpinColumn(layout, menuCol.key) : pinColumn(layout, menuCol.key))}
          onMove={(dir) => onLayoutChange(moveColumn(layout, menuCol.key, dir))}
          onRename={(label) => onRename(menuCol.key, label)}
          onHide={() => onLayoutChange(hideColumn(layout, menuCol.key))}
        />
      )}
    </div>
  );
}

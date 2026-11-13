"use client";

// View settings (columns) popover (EDGEX-117). Replaces the Edit-columns dialog in v2: changes
// apply immediately, there is no Apply button. Reuses the dnd-kit sortable pattern of
// column-manager-dialog.tsx.

import { useMemo, useState, type ReactNode } from "react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowCounterClockwiseIcon, DotsSixVerticalIcon, EyeIcon, EyeSlashIcon, MagnifyingGlassIcon } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Icon } from "@/components/icons";
import { FALLBACK_COLUMN_ICON } from "./v2-columns";
import { hideColumn, reorderColumns, showColumn, type ColumnLayout } from "./grid-layout";
import { ITEM, POP, POP_LABEL, POP_SEP } from "@/components/filters/toolbar/tokens";

/** What the popover reads from a column (a Leads LeadColumn fits; so does an Applications list column). */
export interface PopoverColumn {
  key: string;
  label: string;
  v2?: { icon?: Icon };
}

export interface ColumnsPopoverProps<C extends PopoverColumn = PopoverColumn> {
  trigger: ReactNode;
  /** Every column a user may show, excluding Name. */
  columns: C[];
  layout: ColumnLayout;
  titleFor: (col: C) => string;
  onLayoutChange: (next: ColumnLayout) => void;
  onReset: () => void;
  /** dnd-kit context id (stable for SSR); defaults to the Leads one. */
  dndId?: string;
  testId?: string;
}

function ShownRow({ col, title, pinned, canDrag, onHide }: { col: PopoverColumn; title: string; pinned: boolean; canDrag: boolean; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key, disabled: !canDrag });
  const Icon = col.v2?.icon ?? FALLBACK_COLUMN_ICON;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex h-8 items-center gap-2 rounded-ds-xs px-1.5 hover:bg-ds-hover"
      data-testid={`shown-column-${col.key}`}
    >
      <button
        type="button"
        aria-label={`Drag ${title} to reorder`}
        className={`touch-none text-ds-ghost ${canDrag ? "cursor-grab hover:text-ds-faint active:cursor-grabbing" : "cursor-not-allowed opacity-50"}`}
        {...attributes}
        {...(canDrag ? listeners : {})}
      >
        <DotsSixVerticalIcon className="size-4" />
      </button>
      <Icon className="size-4 shrink-0 text-ds-faint" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {pinned && <span className="text-xs font-medium text-ds-faint">Pinned</span>}
      <button type="button" onClick={onHide} aria-label={`Hide ${title}`} className="rounded-ds-xs p-1 text-ds-faint hover:text-ds-ink">
        <EyeIcon className="size-4" />
      </button>
    </div>
  );
}

export function ColumnsPopover<C extends PopoverColumn>({
  trigger,
  columns,
  layout,
  titleFor,
  onLayoutChange,
  onReset,
  dndId = "leads-columns-dnd",
  testId = "columns-popover",
}: ColumnsPopoverProps<C>) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const q = search.trim().toLowerCase();
  const matches = (c: C) => !q || titleFor(c).toLowerCase().includes(q) || c.label.toLowerCase().includes(q);

  const shown = layout.keys.map((k) => byKey.get(k)).filter((c): c is C => !!c);
  const hidden = columns.filter((c) => !layout.keys.includes(c.key));
  const shownVisible = shown.filter(matches);
  const hiddenVisible = hidden.filter(matches);

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = layout.keys.indexOf(String(active.id));
    const to = layout.keys.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onLayoutChange(reorderColumns(layout, arrayMove(layout.keys, from, to)));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className={`${POP} w-[280px]`} data-testid={testId}>
        <div className="-mx-1 -mt-1 mb-1 flex h-9 items-center gap-2 rounded-t-[10px] border-b border-ds-divider px-2.5 text-ds-faint">
          <MagnifyingGlassIcon className="size-4 shrink-0" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a field…"
            aria-label="Find a field"
            className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-ds-ink outline-none placeholder:text-ds-faint"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          <div className={POP_LABEL}>Shown · drag to reorder</div>
          <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shownVisible.map((c) => c.key)} strategy={verticalListSortingStrategy}>
              {shownVisible.map((c) => (
                <ShownRow
                  key={c.key}
                  col={c}
                  title={titleFor(c)}
                  pinned={layout.pins.includes(c.key)}
                  canDrag={!q}
                  onHide={() => onLayoutChange(hideColumn(layout, c.key))}
                />
              ))}
            </SortableContext>
          </DndContext>
          {shownVisible.length === 0 && <div className="px-2 py-1.5 text-sm font-normal text-ds-faint">{q ? "No shown fields match" : "No fields shown"}</div>}

          {hiddenVisible.length > 0 && (
            <>
              <div className={POP_LABEL}>Hidden</div>
              {hiddenVisible.map((c) => {
                const Icon = c.v2?.icon ?? FALLBACK_COLUMN_ICON;
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={`${ITEM} h-8 px-1.5 text-ds-muted`}
                    onClick={() => onLayoutChange(showColumn(layout, c.key))}
                    aria-label={`Show ${titleFor(c)}`}
                  >
                    <span className="size-4 shrink-0" />
                    <Icon className="size-4 shrink-0 text-ds-faint" />
                    <span className="min-w-0 flex-1 truncate">{titleFor(c)}</span>
                    <EyeSlashIcon className="size-4 text-ds-faint" />
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className={POP_SEP} />
        <button
          type="button"
          className={ITEM}
          onClick={() => {
            onReset();
            setSearch("");
          }}
        >
          <ArrowCounterClockwiseIcon className="size-4 text-ds-faint" />
          Reset to default
        </button>
      </PopoverContent>
    </Popover>
  );
}

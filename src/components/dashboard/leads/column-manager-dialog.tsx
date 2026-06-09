"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Search, GripVertical, X, Lock } from "lucide-react";
import type { LeadColumn } from "./columns-registry";

interface ColumnManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full column catalog from getLeadColumns() — includes name + actions anchors. */
  allColumns: LeadColumn[];
  /** Currently visible middle keys (excludes name + actions anchors). */
  currentMiddleKeys: string[];
  /** Default visible middle keys (excludes anchors). Used by Reset. */
  defaultMiddleKeys: string[];
  onApply: (keys: string[]) => void;
  onReset: () => void;
}

// ── Draggable item in the right "selected" panel ─────────────────────────────

function SortableItem({
  col,
  onRemove,
}: {
  col: LeadColumn;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.key });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-gray-200 rounded text-sm"
    >
      <button
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 touch-none"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <span className="flex-1 truncate text-gray-700">{col.label}</span>
      <button
        onClick={onRemove}
        className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
        aria-label={`Remove ${col.label}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function LockedItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 border border-gray-200 rounded text-sm cursor-not-allowed">
      <Lock size={12} className="text-gray-400 shrink-0" />
      <span className="flex-1 truncate text-gray-500">{label}</span>
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

export function ColumnManagerDialog({
  open,
  onOpenChange,
  allColumns,
  currentMiddleKeys,
  defaultMiddleKeys,
  onApply,
  onReset,
}: ColumnManagerDialogProps) {
  const [search, setSearch] = useState("");
  const [middleKeys, setMiddleKeys] = useState<string[]>(currentMiddleKeys);

  // Sync state when dialog opens
  useEffect(() => {
    if (open) {
      setMiddleKeys(currentMiddleKeys);
      setSearch("");
    }
    // Intentionally exclude currentMiddleKeys — only sync on open event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const colMap = useMemo(
    () => new Map(allColumns.map((c) => [c.key, c])),
    [allColumns],
  );

  // Left-panel columns: exclude required anchors (name + actions)
  const editableCols = useMemo(
    () => allColumns.filter((c) => !c.required),
    [allColumns],
  );

  const filteredCols = useMemo(() => {
    if (!search) return editableCols;
    const lower = search.toLowerCase();
    return editableCols.filter((c) => c.label.toLowerCase().includes(lower));
  }, [editableCols, search]);

  const groups = useMemo(() => ({
    standard: editableCols.filter((c) => c.group === "standard"),
    industry: editableCols.filter((c) => c.group === "industry"),
    custom: editableCols.filter((c) => c.group === "custom"),
  }), [editableCols]);

  const middleSet = useMemo(() => new Set(middleKeys), [middleKeys]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setMiddleKeys((prev) => {
      const oldIdx = prev.indexOf(String(active.id));
      const newIdx = prev.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  function toggleKey(key: string) {
    setMiddleKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function handleApply() {
    onApply(middleKeys);
    onOpenChange(false);
  }

  function handleReset() {
    setMiddleKeys(defaultMiddleKeys);
    onReset();
    onOpenChange(false);
  }

  function handleCancel() {
    onOpenChange(false);
  }

  function renderChecklist(cols: LeadColumn[]) {
    return cols.map((col) => (
      <label
        key={col.key}
        className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
      >
        <input
          type="checkbox"
          checked={middleSet.has(col.key)}
          onChange={() => toggleKey(col.key)}
          className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900"
        />
        <span className="text-sm text-gray-700">{col.label}</span>
      </label>
    ));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <DialogTitle className="text-base">Choose which columns you see</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[380px] max-h-[480px]">
          {/* Left: Searchable checklist */}
          <div className="flex-1 flex flex-col border-r overflow-hidden">
            <div className="p-3 border-b shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search columns…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full h-8 pl-8 pr-3 text-sm rounded border border-input bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {search ? (
                filteredCols.length > 0 ? (
                  renderChecklist(filteredCols)
                ) : (
                  <p className="text-xs text-gray-400 text-center py-6">No columns match</p>
                )
              ) : (
                <>
                  {groups.standard.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                        Standard
                      </p>
                      {renderChecklist(groups.standard)}
                    </div>
                  )}
                  {groups.industry.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                        Industry
                      </p>
                      {renderChecklist(groups.industry)}
                    </div>
                  )}
                  {groups.custom.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                        Custom fields
                      </p>
                      {renderChecklist(groups.custom)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right: Ordered selection */}
          <div className="w-52 flex flex-col overflow-hidden shrink-0">
            <div className="p-3 border-b shrink-0">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Selected ({middleKeys.length + 2})
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              <div className="flex flex-col gap-1">
                <LockedItem label="Name" />
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={middleKeys}
                    strategy={verticalListSortingStrategy}
                  >
                    {middleKeys.map((key) => {
                      const col = colMap.get(key);
                      if (!col) return null;
                      return (
                        <SortableItem
                          key={key}
                          col={col}
                          onRemove={() =>
                            setMiddleKeys((prev) => prev.filter((k) => k !== key))
                          }
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
                <LockedItem label="Actions" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t flex-row items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="mr-auto text-xs text-gray-500 hover:text-gray-800"
          >
            Reset to default
          </Button>
          <Button variant="outline" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

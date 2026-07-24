"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ApplicationColumnDef {
  key: string;
  label: string;
}

interface ApplicationsColumnManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Toggleable columns (excludes the Student anchor, which is always shown). */
  columns: readonly ApplicationColumnDef[];
  visibleKeys: string[];
  defaultKeys: string[];
  onApply: (keys: string[]) => void;
}

/** Applications-only column visibility picker — show/hide only, no reordering.
 * Deliberately not shared with Leads' Column Manager. */
export function ApplicationsColumnManager({
  open,
  onOpenChange,
  columns,
  visibleKeys,
  defaultKeys,
  onApply,
}: ApplicationsColumnManagerProps) {
  const [keys, setKeys] = useState<string[]>(visibleKeys);

  useEffect(() => {
    if (!open) return;
    // Why: react-hooks/set-state-in-effect rejects synchronous setState inside an
    // effect body; deferring via setTimeout places the update outside the
    // synchronous effect execution (matches tag-multi-picker.tsx's convention).
    const id = setTimeout(() => setKeys(visibleKeys), 0);
    return () => clearTimeout(id);
  }, [open, visibleKeys]);

  function toggle(key: string) {
    setKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function handleApply() {
    onApply(keys);
    onOpenChange(false);
  }

  function handleReset() {
    onApply(defaultKeys);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-4 border-b">
          <DialogTitle className="text-base">Choose which columns you see</DialogTitle>
        </DialogHeader>

        <div className="p-3 max-h-80 overflow-y-auto">
          <label className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-not-allowed opacity-60">
            <input type="checkbox" checked disabled className="h-3.5 w-3.5 rounded border-gray-300" />
            <span className="text-sm text-gray-500">Student (always shown)</span>
          </label>
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2.5 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={keys.includes(col.key)}
                onChange={() => toggle(col.key)}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-gray-900"
              />
              <span className="text-sm text-gray-700">{col.label}</span>
            </label>
          ))}
        </div>

        <DialogFooter className="px-5 py-4 border-t flex-row items-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="mr-auto text-xs text-gray-500 hover:text-gray-800"
          >
            Reset to default
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
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

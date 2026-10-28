"use client";

// "Saved filters" button for the Leads toolbar (education_consultancy). One click reapplies a named filter the user
// saved earlier; "Save current filter" stores whatever is on the filter bar right now. Private to the signed-in user.

import { useState } from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isEmptyTree } from "@/lib/filters/serialize";
import type { FieldRegistry, FilterTree } from "@/lib/filters/types";
import { prepareSavedFilterTree } from "../lib/apply-saved-filter";
import { useSavedLeadFilters } from "../lib/use-saved-lead-filters";
import { MAX_SAVED_FILTER_NAME_LENGTH } from "../lib/saved-filter-schema";

interface SavedFiltersMenuProps {
  /** The filter tree currently shown on the bar (what "Save current filter" stores). */
  tree: FilterTree;
  registry: FieldRegistry;
  onApply: (tree: FilterTree) => void;
  className?: string;
}

export function SavedFiltersMenu({ tree, registry, onApply, className }: SavedFiltersMenuProps) {
  const { filters, loading, loaded, load, save, remove } = useSavedLeadFilters();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const nothingToSave = isEmptyTree(tree);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    setConfirmDeleteId(null);
    if (next && !loaded) {
      const err = await load();
      if (err) toast.error(err);
    }
  }

  function handleApply(filterTree: FilterTree) {
    const { tree: prepared, dropped } = prepareSavedFilterTree(filterTree, registry);
    const remaining = prepared.conditions.length + (prepared.groups ?? []).reduce((n, g) => n + g.conditions.length, 0);
    if (remaining === 0) {
      toast.error("This saved filter no longer applies to your leads.");
      return;
    }
    if (dropped > 0) toast.info(`${dropped} part${dropped === 1 ? "" : "s"} of this filter no longer exist and were skipped.`);
    onApply(prepared);
    setOpen(false);
  }

  async function handleSave() {
    if (nothingToSave || saving) return;
    setSaving(true);
    const err = await save(name, tree);
    setSaving(false);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success(`Saved “${name.trim()}”`);
    setName("");
  }

  async function handleDelete(id: string) {
    const err = await remove(id);
    setConfirmDeleteId(null);
    if (err) toast.error(err);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className={className}>
          <Bookmark className="h-3 w-3 shrink-0" />
          Saved filters
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="max-h-64 overflow-y-auto py-1">
          {loading && !loaded ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
          ) : filters.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No saved filters yet. Set up a filter, then save it below.
            </p>
          ) : (
            filters.map((f) => (
              <div key={f.id} className="group flex items-center gap-1 px-1">
                {confirmDeleteId === f.id ? (
                  <div className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-xs">
                    <span className="truncate">Delete “{f.name}”?</span>
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => handleDelete(f.id)}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </Button>
                    </span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleApply(f.filter_tree)}
                      className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      title={f.name}
                    >
                      {f.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete saved filter ${f.name}`}
                      onClick={() => setConfirmDeleteId(f.id)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
        <div className="space-y-2 border-t p-3">
          <p className="text-xs font-medium text-muted-foreground">Save current filter</p>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder={nothingToSave ? "Add a filter first" : "Name, e.g. Amit — Prospects"}
            maxLength={MAX_SAVED_FILTER_NAME_LENGTH}
            disabled={nothingToSave}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-7 w-full text-xs" onClick={handleSave} disabled={nothingToSave || saving || name.trim() === ""}>
            {saving ? "Saving…" : "Save filter"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

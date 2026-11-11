"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dot } from "./parts";
import type { LeadList, PipelineStage } from "@/types/database";

export interface StageChoice {
  listId: string;
  stageId: string;
  pipelineId: string | null;
}

/**
 * The Stage card's dropdown (mockup state 4): 280px, anchored under the card's left edge. Group headers = lead
 * lists in sort order; items = that list's stages with their dot; grey check on the current one. Same
 * Popover + Command build as `SearchableSelect` (the EDGEX-145 look).
 */
export function StagePicker({
  open, onOpenChange, lists, stages, currentListId, currentStageId, onPick, children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Already filtered: pipeline lists only (no staging/archived/admin-only for this user). */
  lists: LeadList[];
  stages: PipelineStage[];
  currentListId: string | null;
  currentStageId: string | null;
  onPick: (c: StageChoice) => void;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...lists]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({
        list: l,
        items: stages
          .filter((s) => !!l.pipeline_id && s.pipeline_id === l.pipeline_id)
          .sort((a, b) => a.position - b.position)
          .filter((s) => !needle || s.name.toLowerCase().includes(needle) || l.name.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.items.length > 0);
  }, [lists, stages, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) setQuery(""); onOpenChange(o); }}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[280px] overflow-hidden p-0 outline-none ring-0"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} className="bg-transparent outline-none focus-visible:ring-0">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search stages…" aria-label="Search stages…" />
          <CommandList role="listbox" className="max-h-[260px] p-1">
            {groups.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-ds-faint">No results for “{query.trim()}”</div>
            ) : (
              groups.map((g) => (
                <CommandGroup key={g.list.id} heading={g.list.name} className="p-0">
                  {g.items.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={`${g.list.id}:${s.id}`}
                      role="option"
                      aria-selected={s.id === currentStageId && g.list.id === currentListId}
                      onSelect={() => onPick({ listId: g.list.id, stageId: s.id, pipelineId: g.list.pipeline_id })}
                    >
                      <Dot color={s.color} />
                      <span className="min-w-0 truncate">{s.name}</span>
                      <span className="ml-auto flex size-4 shrink-0 items-center justify-center text-ds-muted">
                        {s.id === currentStageId && g.list.id === currentListId && <CheckIcon className="size-4" aria-hidden />}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

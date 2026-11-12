"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface PickerOption {
  value: string;
  label: string;
  secondary?: string;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
}

/**
 * One searchable list in a popover (same Popover + Command build as StagePicker / SearchableSelect) anchored to
 * whatever it wraps. Used by every in-place pick on the lead detail: status, counsellor, collaborators, tags, countries,
 * level. `selected` rows get the tick; `keepOpen` (collaborators) leaves it open after Enter.
 */
export function Picker({
  open, onOpenChange, options, selected, onPick, placeholder = "Search…", keepOpen = false, footer, emptyText = "No results", width = 260, children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: PickerOption[];
  selected: string[];
  onPick: (value: string) => void;
  placeholder?: string;
  keepOpen?: boolean;
  /** Last row, e.g. Unassign or Create "<text>". Receives the current query. */
  footer?: (query: string) => { label: string; onSelect: () => void; icon?: ReactNode } | null;
  emptyText?: string;
  width?: number;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle) || (o.secondary ?? "").toLowerCase().includes(needle));
    const order: string[] = [];
    const by = new Map<string, PickerOption[]>();
    for (const o of shown) {
      const g = o.group ?? "";
      if (!by.has(g)) { by.set(g, []); order.push(g); }
      by.get(g)!.push(o);
    }
    return order.map((g) => ({ heading: g, items: by.get(g)! }));
  }, [options, query]);
  const foot = footer?.(query.trim()) ?? null;

  return (
    <Popover open={open} onOpenChange={(o) => { if (!o) setQuery(""); onOpenChange(o); }}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="start" sideOffset={6} className="overflow-hidden p-0 outline-none ring-0" style={{ width }} onCloseAutoFocus={(e) => e.preventDefault()}>
        <Command shouldFilter={false} className="bg-transparent outline-none focus-visible:ring-0">
          <CommandInput value={query} onValueChange={setQuery} placeholder={placeholder} aria-label={placeholder} />
          <CommandList role="listbox" className="max-h-[260px] p-1">
            {groups.length === 0 && !foot ? (
              <div className="px-2 py-6 text-center text-sm text-ds-faint">{emptyText}</div>
            ) : (
              groups.map((g) => (
                <CommandGroup key={g.heading} heading={g.heading || undefined} className="p-0">
                  {g.items.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      role="option"
                      disabled={o.disabled}
                      aria-selected={selected.includes(o.value)}
                      onSelect={() => { onPick(o.value); if (!keepOpen) onOpenChange(false); }}
                    >
                      {o.icon}
                      <span className="min-w-0 truncate">{o.label}</span>
                      {o.secondary && <span className="ml-1 truncate text-ds-faint">{o.secondary}</span>}
                      <span className="ml-auto flex size-4 shrink-0 items-center justify-center text-ds-muted">
                        {selected.includes(o.value) && <CheckIcon className="size-4" aria-hidden />}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            )}
            {foot && (
              <CommandGroup className="mt-1 border-t border-ds-divider p-0 pt-1">
                <CommandItem value="__footer__" role="option" onSelect={() => { foot.onSelect(); onOpenChange(false); }}>
                  {foot.icon}
                  <span className="min-w-0 truncate">{foot.label}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { useState } from "react";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  onCreateNew?: (val: string) => Promise<void>;
}

// Shared by all 3 Add Application screens (the lead-scoped sheet, the
// standalone board's sheet, and the application edit page) — previously
// copy-pasted verbatim into each.
export function AutocompleteInput({ value, onChange, suggestions, placeholder, id, onCreateNew }: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const trimmed = value.trim();
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showCreate = onCreateNew && trimmed.length > 0 && !exactMatch;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            id={id}
            value={value}
            onChange={(e) => { onChange(e.target.value); if (!open && e.target.value) setOpen(true); }}
            onFocus={() => { if (filtered.length > 0 || showCreate) setOpen(true); }}
            placeholder={placeholder}
            className="pr-8"
            autoComplete="off"
          />
          <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverTrigger>
      {(filtered.length > 0 || showCreate) && (
        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width]"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onWheel={(e) => e.stopPropagation()}
        >
          <Command shouldFilter={false}>
            <CommandList className="max-h-52 overflow-y-auto">
              <CommandEmpty>No matches</CommandEmpty>
              {filtered.slice(0, 20).map((s) => (
                <CommandItem key={s} value={s} onSelect={() => { onChange(s); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === s ? "opacity-100" : "opacity-0")} />
                  {s}
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  disabled={creating}
                  onSelect={async () => {
                    if (!onCreateNew) return;
                    setCreating(true);
                    await onCreateNew(trimmed);
                    setCreating(false);
                    setOpen(false);
                  }}
                  className="text-primary font-medium border-t mt-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {creating ? "Adding…" : `Create "${trimmed}"`}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}

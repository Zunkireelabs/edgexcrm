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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

export interface AutocompleteInputProps {
  value: string;
  onChange: (val: string) => void;
  suggestions: string[];
  placeholder?: string;
  id?: string;
  onCreateNew?: (val: string) => Promise<void>;
  /** Noun for the confirm dialog copy, e.g. "university", "program". Defaults to "item". */
  createLabel?: string;
  /** Skip the built-in "Create X?" confirm and call onCreateNew immediately on select —
   *  for callers with their own richer confirmation UI (e.g. University's combined
   *  create-with-programs dialog). */
  skipConfirm?: boolean;
}

// Shared by all 3 Add Application screens (the lead-scoped sheet, the
// standalone board's sheet, and the application edit page) — previously
// copy-pasted verbatim into each.
export function AutocompleteInput({ value, onChange, suggestions, placeholder, id, onCreateNew, createLabel = "item", skipConfirm = false }: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<string | null>(null);
  const trimmed = value.trim();
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(trimmed.toLowerCase()));
  const exactMatch = suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const showCreate = onCreateNew && trimmed.length > 0 && !exactMatch;
  return (
    <>
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
                  onSelect={() => {
                    if (skipConfirm) {
                      onCreateNew?.(trimmed);
                      setOpen(false);
                    } else {
                      setPendingCreate(trimmed);
                      setOpen(false);
                    }
                  }}
                  className="text-primary font-medium border-t mt-1"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {`Create "${trimmed}"`}
                </CommandItem>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>

    <AlertDialog open={pendingCreate !== null} onOpenChange={(v) => { if (!v && !creating) setPendingCreate(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create &quot;{pendingCreate}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            This will add &ldquo;{pendingCreate}&rdquo; to your {createLabel} list. It becomes available to everyone and appears in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={creating} onClick={() => setPendingCreate(null)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={creating}
            onClick={async (e) => {
              e.preventDefault();
              if (!onCreateNew || !pendingCreate) return;
              setCreating(true);
              await onCreateNew(pendingCreate);
              setCreating(false);
              setPendingCreate(null);
            }}
          >
            {creating ? "Adding…" : "Create"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

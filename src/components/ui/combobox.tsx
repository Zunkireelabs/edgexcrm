"use client";

// A thin Popover + Command composition — not an upstream shadcn primitive.
// Built from popover.tsx + command.tsx (cmdk), both already installed. Used by
// the advanced-filter field/operator pickers and multi-select value editors.

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
}

interface ComboboxBaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  trigger?: React.ReactNode;
  align?: "start" | "center" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function groupOptions(options: ComboboxOption[]): [string | undefined, ComboboxOption[]][] {
  const groups = new Map<string | undefined, ComboboxOption[]>();
  for (const opt of options) {
    const list = groups.get(opt.group) ?? [];
    list.push(opt);
    groups.set(opt.group, list);
  }
  return Array.from(groups.entries());
}

interface ComboboxSingleProps extends ComboboxBaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string) => void;
}

interface ComboboxMultiProps extends ComboboxBaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

export type ComboboxProps = ComboboxSingleProps | ComboboxMultiProps;

export function Combobox(props: ComboboxProps) {
  const { options, placeholder = "Select…", searchPlaceholder = "Search…", emptyText = "No results found.", className, contentClassName, disabled, trigger, align = "start" } = props;
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = props.onOpenChange ?? setInternalOpen;

  const selectedLabel = React.useMemo(() => {
    if (props.multiple) {
      const count = props.value.length;
      if (count === 0) return placeholder;
      if (count === 1) return options.find((o) => o.value === props.value[0])?.label ?? props.value[0];
      return `${count} selected`;
    }
    return options.find((o) => o.value === props.value)?.label ?? placeholder;
  }, [props, options, placeholder]);

  function isSelected(value: string): boolean {
    return props.multiple ? props.value.includes(value) : props.value === value;
  }

  function handleSelect(value: string) {
    if (props.multiple) {
      const next = props.value.includes(value) ? props.value.filter((v) => v !== value) : [...props.value, value];
      props.onChange(next);
      // keep the popover open for multi-select — mirrors FilterOptionList's behavior
    } else {
      props.onChange(value);
      setOpen(false);
    }
  }

  const grouped = groupOptions(options);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            className={cn(
              "inline-flex h-8 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className={cn("w-64 p-0", contentClassName)}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {grouped.map(([group, opts]) => (
              <CommandGroup key={group ?? "__ungrouped__"} heading={group}>
                {opts.map((opt) => (
                  <CommandItem key={opt.value} value={`${opt.label} ${opt.value}`} onSelect={() => handleSelect(opt.value)}>
                    <Check className={cn("size-3.5", isSelected(opt.value) ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{opt.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

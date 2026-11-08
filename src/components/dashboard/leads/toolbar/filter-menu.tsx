"use client";

// "Filter" control + its popover (mockup states "Filter menu" and "Pick values").
// Screen 1: searchable field list (Most used first). Screen 2: the field's values / editor.
// Reuses the filter engine's condition types, defaults and editor — no new predicate path.

import { useState } from "react";
import { FunnelSimpleIcon, PlusIcon } from "@/components/icons";
import { newConditionId } from "@/components/filters/condition-defaults";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FieldDef, FilterTree } from "@/lib/filters/types";
import { cn } from "@/lib/utils";
import { isOptionField } from "./chip-parts";
import { ConditionBody, type OptionContext } from "./condition-body";
import { FieldMenuPanel } from "./panels";
import { findConditionForField } from "./tree-edit";
import { CTRL_MUTED, POP } from "./tokens";

type Screen = { kind: "menu" } | { kind: "field"; field: FieldDef; conditionId: string };

export interface FilterMenuProps {
  fields: FieldDef[];
  tree: FilterTree;
  onChange: (tree: FilterTree) => void;
  ctx: OptionContext;
  /** Registry keys offered first (Stage, Assigned to, Last activity). */
  mostUsedKeys: string[];
  /** "chip" = the "Filter" control; "plus" = the icon-only add button shown once chips exist. */
  variant: "chip" | "plus";
  maxConditions: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilterMenu({ fields, tree, onChange, ctx, mostUsedKeys, variant, maxConditions, open, onOpenChange }: FilterMenuProps) {
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  const atCap = tree.conditions.length >= maxConditions;

  function handleOpenChange(next: boolean) {
    if (next) setScreen({ kind: "menu" });
    onOpenChange(next);
  }

  function pick(field: FieldDef) {
    // Re-picking a field that already has a chip reopens THAT chip (two ANDed "Stage is X"
    // chips can never match the same lead), otherwise start a fresh one.
    const existing = findConditionForField(tree, field.key);
    setScreen({ kind: "field", field, conditionId: existing?.id ?? newConditionId() });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {variant === "chip" ? (
          <button type="button" data-testid="leads-filter-trigger" className={cn(CTRL_MUTED, open && "bg-ds-hover text-ds-ink")}>
            <FunnelSimpleIcon className="size-4" />
            Filter
          </button>
        ) : (
          <button
            type="button"
            data-testid="leads-filter-trigger"
            aria-label="Add filter"
            title="Add filter"
            className={cn(CTRL_MUTED, "w-7 justify-center px-0", open && "bg-ds-hover text-ds-ink")}
          >
            <PlusIcon className="size-4" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className={POP}>
        {screen.kind === "menu" ? (
          <FieldMenuPanel
            fields={fields}
            mostUsedKeys={mostUsedKeys}
            optionCount={(f) => {
              const options = ctx.getOptions(f);
              return isOptionField(f, options) ? options.length : undefined;
            }}
            onSelect={pick}
          />
        ) : (
          <ConditionBody
            key={`${screen.field.key}:${screen.conditionId}`}
            field={screen.field}
            conditionId={screen.conditionId}
            tree={tree}
            onChange={onChange}
            onDone={() => onOpenChange(false)}
            ctx={ctx}
            canAdd={!atCap}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

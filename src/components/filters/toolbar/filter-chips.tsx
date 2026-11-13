"use client";

// Inline sentence chips: [icon Field] [operator] [value] [✕]  (mockup `.fchip`).
// Click the field or value to edit it, the operator to change it in plain words, ✕ to drop it.
// The chips only compute the next FilterTree; leads-table owns it (URL ?f= + Stage-tab sync).

import { useMemo, useState } from "react";
import { CheckIcon, XIcon } from "@/components/icons";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { reshapeValueForOperator } from "@/components/filters/condition-defaults";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { conditionSchema } from "@/lib/filters/schema";
import { operatorsForField } from "@/lib/filters/operators";
import type { FieldDef, FilterCondition, FilterOperator, FilterTree } from "@/lib/filters/types";
import { cn } from "@/lib/utils";
import { chipValueText, conditionHasValue, isOptionField, plainOperatorLabel, selectedValues } from "./chip-parts";
import { ConditionBody, type OptionContext } from "./condition-body";
import { FieldIcon } from "./field-icon";
import { toOptionRows } from "./option-view";
import { removeCondition, upsertCondition } from "./tree-edit";
import { ITEM, POP } from "./tokens";

const SEG = "flex items-center gap-1.5 px-2 transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:bg-ds-hover";
const SEG_DIVIDER = "border-l border-ds-divider";
/** A clickable part of the pill chip: no box of its own, the pill's 6px gap spaces the parts. */
const PILL_PART =
  "inline-flex items-center gap-1.5 rounded-[4px] transition-colors hover:text-ds-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost";

/** Plain-word operator choices for a pick-list field: is / is not / is empty / is not empty. */
const OPTION_FIELD_OPS: { op: FilterOperator; label: string }[] = [
  { op: "is_any_of", label: "is" },
  { op: "is_none_of", label: "is not" },
  { op: "is_empty", label: "is empty" },
  { op: "is_not_empty", label: "is not empty" },
];

const LIST_OPS = new Set<FilterOperator>(["is_any_of", "is_none_of", "has_all"]);

export interface FilterChipsProps {
  fields: FieldDef[];
  tree: FilterTree;
  onChange: (tree: FilterTree) => void;
  ctx: OptionContext;
  maxConditions: number;
  /**
   * "segmented" (default) = the Leads chip: four bordered segments with dividers.
   * "pill" = the Applications chip (applications-board mockup state 2): one 28px pill, icon + field +
   * muted operator + bold value + ×, no dividers. Each part still opens the same editor.
   */
  variant?: "segmented" | "pill";
  /**
   * "popover" (default, Leads + desktop Applications) or "sheet" (Applications below md, EDGEX-141
   * Phase 5): a chip's edit / operator menu opens in a bottom sheet. Same chip, same editors.
   */
  container?: "popover" | "sheet";
}

export function FilterChips({ fields, tree, onChange, ctx, maxConditions, variant = "segmented", container = "popover" }: FilterChipsProps) {
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  return (
    <>
      {tree.conditions.map((condition) => {
        const field = byKey.get(condition.field);
        if (!field) return null;
        return (
          <SentenceChip
            key={condition.id}
            field={field}
            condition={condition}
            tree={tree}
            onChange={onChange}
            ctx={ctx}
            canAdd={tree.conditions.length < maxConditions}
            variant={variant}
            container={container}
          />
        );
      })}
    </>
  );
}

type Mode = null | "edit" | "operator";

function SentenceChip({
  field,
  condition,
  tree,
  onChange,
  ctx,
  canAdd,
  variant,
  container,
}: {
  field: FieldDef;
  condition: FilterCondition;
  tree: FilterTree;
  onChange: (tree: FilterTree) => void;
  ctx: OptionContext;
  canAdd: boolean;
  variant: "segmented" | "pill";
  container: "popover" | "sheet";
}) {
  const [mode, setMode] = useState<Mode>(null);
  // An operator change whose value isn't valid yet (e.g. "contains" with nothing typed) opens the
  // editor on that pending condition instead of committing something the URL would reject.
  const [pending, setPending] = useState<FilterCondition | undefined>(undefined);

  const options = ctx.getOptions(field);
  const optionField = isOptionField(field, options);
  const rows = useMemo(
    () => toOptionRows(field.key, options, ctx.countSources, null, ctx.optionColors?.[field.key]),
    [field.key, options, ctx.countSources, ctx.optionColors],
  );
  const cleanOptions = useMemo(() => rows.map((r) => ({ value: r.value, label: r.label, color: r.color })), [rows]);

  const hasValue = conditionHasValue(condition.op);
  const valueText = chipValueText(condition, cleanOptions);
  const picked = selectedValues(condition);
  const dot = picked.length === 1 ? rows.find((r) => r.value === picked[0])?.color : undefined;

  function close() {
    setMode(null);
    setPending(undefined);
  }

  function chooseOperator(op: FilterOperator) {
    let value = reshapeValueForOperator(field, condition.op, op, condition.value);
    // Pick-list chips keep their ticked values across is <-> is not (and is_any_of's scalar `is` seed).
    if (optionField && LIST_OPS.has(op)) value = selectedValues(condition);
    const next: FilterCondition = { ...condition, op, value };
    if (conditionSchema.safeParse(next).success) {
      onChange(upsertCondition(tree, next));
      close();
      return;
    }
    setPending(next);
    setMode("edit");
  }

  const operatorChoices = optionField
    ? OPTION_FIELD_OPS.filter(({ op }) => LIST_OPS.has(op) || operatorsForField(field).includes(op))
    : operatorsForField(field).map((op) => ({ op, label: plainOperatorLabel({ ...condition, op, value: undefined }) }));

  const chip =
    variant === "pill" ? (
      <span
        data-testid="filter-chip"
        data-variant="pill"
        className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-ds-border bg-ds-sunken px-2.5 text-[13px] font-medium text-ds-ink"
      >
        <button type="button" className={PILL_PART} onClick={() => setMode("edit")} aria-label={`Edit ${field.label} filter`}>
          <FieldIcon field={field} className="size-[15px] shrink-0" />
          {field.label}
        </button>
        <button type="button" className={cn(PILL_PART, "font-normal text-ds-muted")} onClick={() => setMode("operator")} aria-label={`Change ${field.label} operator`}>
          {plainOperatorLabel(condition)}
        </button>
        {hasValue && (
          <button type="button" className={cn(PILL_PART, "font-semibold")} onClick={() => setMode("edit")} aria-label={`Edit ${field.label} value`}>
            {dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
            <span className="max-w-[220px] truncate">{valueText || "…"}</span>
          </button>
        )}
        <button
          type="button"
          className={cn(PILL_PART, "text-ds-faint hover:text-ds-ink")}
          onClick={() => onChange(removeCondition(tree, condition.id))}
          aria-label={`Remove ${field.label} filter`}
        >
          ×
        </button>
      </span>
    ) : (
      <span
        data-testid="filter-chip"
        className="inline-flex h-7 shrink-0 items-stretch overflow-hidden rounded-ds-sm bg-ds-surface text-sm font-medium shadow-[inset_0_0_0_1px_var(--ds-border)]"
      >
        <button type="button" className={cn(SEG, "text-ds-muted")} onClick={() => setMode("edit")} aria-label={`Edit ${field.label} filter`}>
          <FieldIcon field={field} className="size-4 shrink-0" />
          {field.label}
        </button>
        <button type="button" className={cn(SEG, SEG_DIVIDER, "text-ds-muted")} onClick={() => setMode("operator")} aria-label={`Change ${field.label} operator`}>
          {plainOperatorLabel(condition)}
        </button>
        {hasValue && (
          <button type="button" className={cn(SEG, SEG_DIVIDER, "text-ds-ink")} onClick={() => setMode("edit")} aria-label={`Edit ${field.label} value`}>
            {dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />}
            <span className="max-w-[220px] truncate">{valueText || "…"}</span>
          </button>
        )}
        <button
          type="button"
          className={cn(SEG, SEG_DIVIDER, "px-1.5 text-ds-faint hover:text-ds-ink")}
          onClick={() => onChange(removeCondition(tree, condition.id))}
          aria-label={`Remove ${field.label} filter`}
        >
          <XIcon className="size-3.5" />
        </button>
      </span>
    );

  const body =
    mode === "operator" ? (
      <div className="w-[200px]" role="listbox" aria-label={`${field.label} operator`}>
        {operatorChoices.map(({ op, label }) => {
          const current = condition.op === op || (optionField && op === "is_any_of" && condition.op === "is");
          return (
            <button key={op} type="button" role="option" aria-selected={current} className={ITEM} onClick={() => chooseOperator(op)}>
              {label}
              {current && <CheckIcon className="ml-auto size-4 text-ds-muted" />}
            </button>
          );
        })}
      </div>
    ) : mode === "edit" ? (
      <ConditionBody
        field={field}
        conditionId={condition.id}
        tree={tree}
        onChange={onChange}
        onDone={close}
        ctx={ctx}
        canAdd={canAdd}
        initial={pending}
      />
    ) : null;

  if (container === "sheet") {
    return (
      <>
        {chip}
        <BottomSheet open={mode !== null} onOpenChange={(o) => !o && close()} title={field.label} testId="filter-chip-sheet">
          {body}
        </BottomSheet>
      </>
    );
  }

  return (
    <Popover open={mode !== null} onOpenChange={(o) => !o && close()}>
      <PopoverAnchor asChild>
        {chip}
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} className={POP}>
        {body}
      </PopoverContent>
    </Popover>
  );
}

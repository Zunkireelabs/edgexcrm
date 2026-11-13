"use client";

// What opens after a field is picked, or when a chip's field/value is clicked:
//   - a pick-list field (Stage, Assigned to, Source …) -> the checkbox "Pick values" panel,
//     applied live (each tick updates the chip; nothing is saved until "Save as view")
//   - any other field (text, date, number …)            -> the existing operator + value editor
//     with its Apply button (reused unchanged: same schema validation as the URL round-trip)

import { useEffect, useMemo, useState } from "react";
import { FilterConditionEditor } from "@/components/filters/filter-condition-editor";
import { newConditionForField } from "@/components/filters/condition-defaults";
import type { FilterOption } from "@/components/ui/filter-dropdown";
import type { FieldDef, FilterCondition, FilterTree } from "@/lib/filters/types";
import { conditionForPickedValues, isOptionField, selectedValues, toggleValue } from "./chip-parts";
import { toOptionRows, type CountSources } from "./option-view";
import { ValuesPanel } from "./panels";
import { findCondition, removeCondition, upsertCondition } from "./tree-edit";

/** Lazily supplies per-option counts that never ride in the option labels (e.g. Stage). */
export interface CountLoader {
  supports(fieldKey: string): boolean;
  load(fieldKey: string, signal: AbortSignal): Promise<ReadonlyMap<string, number> | null>;
}

/** Everything the popovers need that comes from leads-table (kept as one object to avoid prop sprawl). */
export interface OptionContext {
  getOptions: (field: FieldDef) => FilterOption[];
  countSources: CountSources;
  countLoader?: CountLoader;
  /** Dot colours that live outside the option (a lead list's own colour), keyed field -> value -> colour. */
  optionColors?: Record<string, ReadonlyMap<string, string>>;
}

export interface ConditionBodyProps {
  field: FieldDef;
  /** Existing condition's id, or a fresh id when this is a new chip. */
  conditionId: string;
  tree: FilterTree;
  onChange: (tree: FilterTree) => void;
  /** Close the popover (Apply on the generic editor). */
  onDone: () => void;
  ctx: OptionContext;
  /** False once the tree is at its condition cap, so a NEW chip can't be added. */
  canAdd: boolean;
  /** Start the generic editor from this condition instead of the saved one (operator change that needs a value). */
  initial?: FilterCondition;
}

export function ConditionBody({ field, conditionId, tree, onChange, onDone, ctx, canAdd, initial }: ConditionBodyProps) {
  const options = ctx.getOptions(field);
  const existing = findCondition(tree, conditionId);

  // Lazy per-option counts (only for fields the host can count scope-correctly).
  const [loaded, setLoaded] = useState<{ key: string; map: ReadonlyMap<string, number> | null } | null>(null);
  const loader = ctx.countLoader;
  useEffect(() => {
    if (!loader?.supports(field.key)) return;
    const controller = new AbortController();
    loader
      .load(field.key, controller.signal)
      .then((map) => {
        if (!controller.signal.aborted) setLoaded({ key: field.key, map });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key: field.key, map: null });
      });
    return () => controller.abort();
  }, [loader, field.key]);

  const wantsLoaded = !!loader?.supports(field.key);
  const countsLoading = wantsLoaded && loaded?.key !== field.key;
  const extraCounts = loaded?.key === field.key ? loaded.map : null;

  const rows = useMemo(
    () => toOptionRows(field.key, options, ctx.countSources, extraCounts, ctx.optionColors?.[field.key]),
    [field.key, options, ctx.countSources, extraCounts, ctx.optionColors],
  );

  if (isOptionField(field, options) && !initial) {
    const selected = selectedValues(existing);
    const negate = existing?.op === "is_none_of" || existing?.op === "is_not";
    return (
      <ValuesPanel
        field={field}
        rows={rows}
        selected={selected}
        countsLoading={countsLoading}
        onToggle={(value) => {
          if (!existing && !canAdd) return;
          const next = conditionForPickedValues({ id: conditionId, field: field.key }, toggleValue(selected, value), negate);
          onChange(next ? upsertCondition(tree, next) : removeCondition(tree, conditionId));
        }}
      />
    );
  }

  return (
    <GenericEditor
      key={initial ? "initial" : "saved"}
      field={field}
      conditionId={conditionId}
      tree={tree}
      onChange={onChange}
      onDone={onDone}
      options={rows.map((r) => ({ value: r.value, label: r.label, color: r.color }))}
      initial={initial}
      canAdd={canAdd}
    />
  );
}

function GenericEditor({
  field,
  conditionId,
  tree,
  onChange,
  onDone,
  options,
  initial,
  canAdd,
}: {
  field: FieldDef;
  conditionId: string;
  tree: FilterTree;
  onChange: (tree: FilterTree) => void;
  onDone: () => void;
  options: FilterOption[];
  initial?: FilterCondition;
  canAdd: boolean;
}) {
  const existing = findCondition(tree, conditionId);
  const [draft, setDraft] = useState<FilterCondition>(
    () => initial ?? existing ?? { ...newConditionForField(field), id: conditionId },
  );
  return (
    <FilterConditionEditor
      field={field}
      condition={draft}
      options={options}
      onChange={setDraft}
      onApply={() => {
        if (!existing && !canAdd) return;
        onChange(upsertCondition(tree, draft));
        onDone();
      }}
    />
  );
}

"use client";

// Dispatches on field.type + operator arity. Text/number/date use native
// inputs (two, side by side, for `between`/`date_between`) — no calendar
// picker dependency, per the Phase 3 brief (§1: no react-day-picker). select/
// multiselect/uuid/relation reuse the existing FilterOptionList verbatim for
// list-shaped operators (is_any_of/is_none_of/has_all) — that component
// (search + checkbox rows + clear) is the one piece of today's filter UI
// worth keeping, and the brief explicitly forbids forking it.

import { Input } from "@/components/ui/input";
import { FilterOptionList, type FilterOption } from "@/components/ui/filter-dropdown";
import type { FieldDef, FilterCondition, FilterValue } from "@/lib/filters/types";
import { RELATIVE_DATE_PRESETS } from "./condition-defaults";

const NO_VALUE_OPS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);
const LIST_OPS = new Set(["is_any_of", "is_none_of", "has_all"]);
const RELATIVE_DATE_OPS = new Set(["within_last", "within_next"]);

export interface FilterValueEditorProps {
  field: FieldDef;
  op: FilterCondition["op"];
  value: FilterValue | undefined;
  options: FilterOption[];
  onChange: (value: FilterValue | undefined) => void;
}

export function FilterValueEditor({ field, op, value, options, onChange }: FilterValueEditorProps) {
  if (NO_VALUE_OPS.has(op)) {
    return <p className="px-1 py-1.5 text-xs text-muted-foreground">No value needed.</p>;
  }

  if (RELATIVE_DATE_OPS.has(op)) {
    const current = typeof value === "string" ? value : "7d";
    return (
      <div className="flex flex-wrap gap-1.5 p-1">
        {RELATIVE_DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            className={`h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              current === preset.value ? "border-foreground bg-foreground text-background" : "border-input bg-background hover:bg-muted"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    );
  }

  if (field.type === "date") {
    if (op === "date_between") {
      const [from, to] = (Array.isArray(value) ? value : ["", ""]) as [string, string];
      return (
        <div className="flex items-center gap-1.5 p-1">
          <Input type="date" className="h-8 text-xs" value={from} onChange={(e) => onChange([e.target.value, to])} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" className="h-8 text-xs" value={to} onChange={(e) => onChange([from, e.target.value])} />
        </div>
      );
    }
    return (
      <div className="p-1">
        <Input type="date" className="h-8 text-xs" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  if (LIST_OPS.has(op)) {
    const current = (Array.isArray(value) ? value : []) as string[];
    // FilterOptionList only renders its "Clear" row once the first option is
    // selected (multiple && value.length > 0) — see filter-dropdown.tsx. That row
    // is ~45px tall, and appearing mid-interaction pushes FilterConditionEditor's
    // Apply button down by that same amount: the user checks an option, then
    // clicks where Apply used to be and hits nothing (ADVANCED-FILTERS-BRIEF
    // Phase 3 addendum — the "Apply bug" §2). Reserve the identical height with a
    // spacer whenever Clear ISN'T shown, so the transition never changes this
    // container's total height and Apply never moves under the cursor. Scoped to
    // this file only — filter-dropdown.tsx (shared with the legacy FilterMenu,
    // which has no Apply button to protect) stays untouched.
    const clearRowShown = current.length > 0;
    return (
      <div className="w-64">
        <FilterOptionList
          options={options}
          multiple
          value={current}
          onSelectSingle={() => {}}
          onSelectMulti={(v) => onChange(current.includes(v) ? current.filter((x) => x !== v) : [...current, v])}
          onClearMulti={() => onChange([])}
        />
        {!clearRowShown && <div className="h-[45px]" aria-hidden="true" />}
      </div>
    );
  }

  if (field.type === "select" || field.type === "uuid" || field.type === "relation") {
    // Single-value scalar ops (is/is_not) against an enumerable option list.
    return (
      <div className="w-64">
        <FilterOptionList
          options={options}
          multiple={false}
          value={typeof value === "string" ? value : ""}
          onSelectSingle={(v) => onChange(v)}
          onSelectMulti={() => {}}
        />
      </div>
    );
  }

  if (op === "between") {
    const [min, max] = (Array.isArray(value) ? value : [0, 0]) as [number, number];
    return (
      <div className="flex items-center gap-1.5 p-1">
        <Input type="number" className="h-8 w-20 text-xs" value={min} onChange={(e) => onChange([Number(e.target.value), max])} />
        <span className="text-xs text-muted-foreground">and</span>
        <Input type="number" className="h-8 w-20 text-xs" value={max} onChange={(e) => onChange([min, Number(e.target.value)])} />
      </div>
    );
  }

  if (field.type === "number") {
    return (
      <div className="p-1">
        <Input type="number" className="h-8 w-28 text-xs" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
      </div>
    );
  }

  // text (is/is_not/contains/not_contains/starts_with/ends_with)
  return (
    <div className="p-1">
      <Input
        type="text"
        autoFocus
        className="h-8 w-56 text-xs"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Value…"
      />
    </div>
  );
}

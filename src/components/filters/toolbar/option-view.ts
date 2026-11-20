// Pick-values rows: a clean label, an optional colour dot and an optional numeric count.
//
// Several option lists in leads-table.tsx bake the count into the label text through
// countSuffix() ("Diplov Karki (449)"). The toolbar wants the number on its own, right-aligned,
// so it strips that suffix — by EXACT match against the suffix countSuffix() would produce
// for that value from the same count map, never by guessing at a "(123)" shape (a source
// genuinely called "Event (2025)" must keep its name). Fields with no count source get no
// number at all: a number is shown only when it is real.

import { countSuffix, type FacetCounts } from "@/lib/leads/facet-labels";
import type { FilterOption } from "@/components/ui/filter-dropdown";

export interface OptionRow {
  value: string;
  label: string;
  color?: string;
  /** undefined = no trustworthy count for this option: render nothing. */
  count?: number;
}

/** Counts keyed by field key, then option value. Maps are the same ones the labels were built from. */
export type CountSources = Record<string, FacetCounts | ReadonlyMap<string, number> | undefined>;

export function toOptionRows(
  fieldKey: string,
  options: FilterOption[],
  countSources: CountSources,
  /** Extra numeric counts that never rode in a label (e.g. per-stage counts fetched lazily). */
  extraCounts?: ReadonlyMap<string, number> | null,
  /** Per-value dot colours that don't live on the option itself (a lead list's own colour). */
  extraColors?: ReadonlyMap<string, string> | null,
): OptionRow[] {
  const source = (countSources[fieldKey] ?? null) as FacetCounts;
  return options.map((o) => {
    if (source) {
      const suffix = countSuffix(source, o.value);
      if (suffix && o.label.endsWith(suffix)) {
        return { value: o.value, label: o.label.slice(0, -suffix.length), color: o.color ?? extraColors?.get(o.value), count: source.get(o.value) ?? 0 };
      }
    }
    const extra = extraCounts?.get(o.value);
    return { value: o.value, label: o.label, color: o.color ?? extraColors?.get(o.value), count: extra };
  });
}

/** Case-insensitive label filter for the Pick-values search box. */
export function filterOptionRows(rows: OptionRow[], query: string): OptionRow[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
}

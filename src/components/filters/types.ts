// Host contract for AdvancedFilterBar — see docs/ADVANCED-FILTERS-BRIEF.md Phase 3 §2/§3.
// Only `fields`/`value`/`onChange` plus three cosmetic flags differ between
// surfaces (leads table today; kanban/board are Phase 4) — that is what lets
// one component tree serve every one of them. Do not add surface-specific
// branches inside the bar itself; add a prop instead.

import type { FieldDef, FilterTree } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";

export type EntityKey = "leads";

// Keys async option loaders are cached under (use-filter-options.ts) — one per
// field that needs a runtime-fetched or host-supplied option list (members,
// stages, lists, forms, tags, sources, …). Not every FieldDef needs one —
// fields with a static `options` array on the FieldDef never consult this.
export type OptionLoaderKey = string;

export interface FilterHostConfig {
  entity: EntityKey;
  /** Already industry- and permission-filtered. */
  fields: FieldDef[];
  value: FilterTree;
  onChange: (next: FilterTree) => void;
  /** Kanban's toolbar is tight — Phase 4 will pass "compact". */
  density?: "comfortable" | "compact";
  showChips?: boolean;
  /** Depth-2 group UI. false on narrow toolbars (not offered in Phase 3's leads-table wiring). */
  allowGroups?: boolean;
  /** Default 25 — mirrors schema.ts's MAX_TOTAL_CONDITIONS. */
  maxConditions?: number;
  /** Host-supplied option lists, keyed by field key — short-circuits the async
   *  loader in use-filter-options.ts. Kanban already has `stages` in props,
   *  which is why this exists as a first-class prop rather than forcing every
   *  surface through a fetch. */
  optionOverrides?: Partial<Record<OptionLoaderKey, FilterOption[]>>;
}

export type { FilterOption } from "@/components/ui/filter-dropdown";

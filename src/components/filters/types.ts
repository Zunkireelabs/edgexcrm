// Host contract for AdvancedFilterBar — see docs/ADVANCED-FILTERS-BRIEF.md Phase 3 §2/§3.
// Only `fields`/`value`/`onChange` plus three cosmetic flags differ between
// surfaces (leads table today; kanban/board are Phase 4) — that is what lets
// one component tree serve every one of them. Do not add surface-specific
// branches inside the bar itself; add a prop instead.

import type { FieldDef, FilterCondition, FilterTree } from "@/lib/filters/types";
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
  /** Hides the internal "+ Add filter" trigger — for a host (leads-table.tsx)
   *  that renders its own copy of AddFilterButton elsewhere (e.g. a separate
   *  row) and wires it to the same value/onChange. Default false — every
   *  other host (the SMS composer) keeps the button bundled in, unaffected. */
  hideAddButton?: boolean;
  /** Default 25 — mirrors schema.ts's MAX_TOTAL_CONDITIONS. */
  maxConditions?: number;
  /** Host-supplied option lists, keyed by field key — short-circuits the async
   *  loader in use-filter-options.ts. Kanban already has `stages` in props,
   *  which is why this exists as a first-class prop rather than forcing every
   *  surface through a fetch. */
  optionOverrides?: Partial<Record<OptionLoaderKey, FilterOption[]>>;
  /** Fires with the in-progress condition while an AddFilterButton/FilterChip
   *  popover is open and editing, `null` once it closes (applied or
   *  discarded). Undefined by default — every host except the SMS composer
   *  leaves this unset and sees zero behavior change. */
  onDraftConditionChange?: (condition: FilterCondition | null) => void;
  /** Opt-in nested-picker override for a single field (email-blast composer's
   *  "Leads Organize" / "Stage→Status" grouping) — see HierarchicalFieldGroups.
   *  Absent everywhere else (SMS composer, leads-table), which keeps
   *  FilterFieldPicker's flat rendering unchanged for those hosts. */
  hierarchicalGroups?: Partial<Record<OptionLoaderKey, HierarchicalFieldGroups>>;
}

export interface HierarchicalLeaf {
  value: string;
  label: string;
}

/** A top-level pickable node (e.g. a pipeline stage) that can itself be
 *  chosen bare, or expanded to reveal `statusOptions` sub-leaves — picking
 *  one of those commits two conditions (this node's field + the status
 *  field) in one shot instead of one. */
export interface HierarchicalStageGroup extends HierarchicalLeaf {
  statusOptions: HierarchicalLeaf[];
}

export interface HierarchicalFieldGroups {
  /** "Leads Organize" — flat leaf items, single-condition commit. */
  orgLists: HierarchicalLeaf[];
  /** "Stage" — each expandable to its Status children. */
  stages: HierarchicalStageGroup[];
  /** "Archive" — plain leaf row, no chevron/expand. Null if tenant has none. */
  archive: HierarchicalLeaf | null;
  /** "Delete" — plain leaf row, no chevron/expand. Null if tenant has none. */
  deleteList: HierarchicalLeaf | null;
}

export type { FilterOption } from "@/components/ui/filter-dropdown";

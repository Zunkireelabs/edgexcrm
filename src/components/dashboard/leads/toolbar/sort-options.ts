// Sort options for the toolbar's one-level Sort control (EDGEX-116; multi-level is EDGEX-120).
// Keys are leads-table's UI SortField values (mapped to API keys there), so nothing here knows a
// column name. Direction wording follows the field's kind ("Newest first" for dates, "A to Z" for
// text); Follow-up needed is a fixed-direction signal (stalest first), as in the old popover.

import { DEFAULT_SORT, type SortDirection, type SortState } from "./view-state";

export type SortKind = "date" | "text" | "stale";

export interface SortOption {
  key: string;
  label: string;
  kind: SortKind;
}

export const SORT_OPTIONS: SortOption[] = [
  { key: "activity", label: "Last activity", kind: "date" },
  { key: "created", label: "Date created", kind: "date" },
  { key: "updated", label: "Last updated", kind: "date" },
  { key: "name", label: "Name", kind: "text" },
  { key: "email", label: "Email", kind: "text" },
  { key: "follow_up_needed", label: "Follow-up needed", kind: "stale" },
];

export function sortOption(key: string): SortOption {
  return SORT_OPTIONS.find((o) => o.key === key) ?? SORT_OPTIONS[0];
}

export interface DirectionOption {
  direction: SortDirection;
  label: string;
}

/** Direction choices for a field. A fixed-direction field offers exactly one. */
export function directionOptions(kind: SortKind): DirectionOption[] {
  if (kind === "date") {
    return [
      { direction: "desc", label: "Newest first" },
      { direction: "asc", label: "Oldest first" },
    ];
  }
  if (kind === "text") {
    return [
      { direction: "asc", label: "A to Z" },
      { direction: "desc", label: "Z to A" },
    ];
  }
  return [{ direction: "asc", label: "Stalest first" }];
}

/** Switching field: a fixed-direction field forces its direction, others keep the current one. */
export function withField(sort: SortState, fieldKey: string): SortState {
  const option = sortOption(fieldKey);
  const allowed = directionOptions(option.kind);
  const direction = allowed.some((d) => d.direction === sort.direction) ? sort.direction : allowed[0].direction;
  return { field: option.key, direction };
}

export function withDirection(sort: SortState, direction: SortDirection): SortState {
  const allowed = directionOptions(sortOption(sort.field).kind);
  return allowed.some((d) => d.direction === direction) ? { ...sort, direction } : sort;
}

export function isDefaultSort(sort: SortState): boolean {
  return sort.field === DEFAULT_SORT.field && sort.direction === DEFAULT_SORT.direction;
}

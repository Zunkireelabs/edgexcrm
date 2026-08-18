// Advanced Filters — the AST + field-registry contract.
//
// Pure types + literal constants. No React, no DOM, no Supabase import — this
// file (and everything else in src/lib/filters/) has zero imports from the rest
// of the app, by design (see docs/ADVANCED-FILTERS-BRIEF.md). Phase 1 has zero
// consumers; a real FieldRegistry for leads lands in a later phase.

export type FilterFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "select"
  | "multiselect"
  | "uuid"
  | "tags"
  | "relation";

export type FilterOperator =
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_any_of"
  | "is_none_of"
  | "has_all"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "before"
  | "after"
  | "on"
  | "date_between"
  | "within_last" // "7d" | "30d" | "3m" | "1y"
  | "within_next"
  | "is_true"
  | "is_false";

// Operators whose naive SQL translation (<>, NOT, NOT IN) evaluates to NULL —
// and therefore EXCLUDES the row — when the underlying column is NULL. Every
// operator in this set must compile to `or(<col>.is.null, <negation>)`, never
// a bare negation. See compile.ts's top-of-file comment for the full rationale.
export const NEGATIVE_OPERATORS: readonly FilterOperator[] = [
  "is_not",
  "not_contains",
  "is_none_of",
] as const;

export type FilterValue =
  | string
  | number
  | boolean
  | string[]
  | [number, number]
  | [string, string];

export interface FilterCondition {
  id: string; // stable client key, round-trips through the URL
  field: string; // REGISTRY key — NEVER a DB column. Resolution happens only in compile.ts
  op: FilterOperator;
  value?: FilterValue;
}

export interface FilterLeafGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
}

export interface FilterGroup {
  conjunction: "and" | "or";
  conditions: FilterCondition[];
  groups?: FilterLeafGroup[]; // depth STOPS here — enforced by the type, not a runtime guard
}

export type FilterTree = FilterGroup;

export const EMPTY_TREE: FilterTree = { conjunction: "and", conditions: [] };

// ── Field registry ──────────────────────────────────────────────────────────

// The discriminant that keeps every documented trap (dual-read legacy jsonb,
// key != column, embed pluralization) out of generic operator code. Every
// column string a compiled query can ever emit comes from one of these
// literals in a registry entry — never from client input. That is the entire
// injection defense for column position (see pgrst.ts for value escaping).
export type FieldSource =
  | { kind: "column"; column: string }
  | { kind: "columns"; columns: string[]; fullNamePairs?: boolean } // the search field
  | { kind: "array_column"; column: string } // tags, destinations
  | { kind: "jsonb"; column: "custom_fields"; path: string }
  | { kind: "promoted"; column: string; jsonb: { column: "custom_fields"; path: string } }
  | { kind: "embed"; relation: string; column: string; embedSelect: string }
  | { kind: "virtual"; compile: (c: FilterCondition, ctx: CompileCtx) => string | null };

// Minimal local mirror of the permission shape a `visibleTo` predicate needs.
// Deliberately NOT imported from src/lib/api/permissions.ts — that would break
// the zero-imports-from-the-rest-of-the-app invariant this phase is built on.
// A real consumer (Phase 2+) can widen this or replace it with the real type
// at the call site without changing anything in this directory.
export interface ResolvedPermissions {
  leadScope?: string;
  [key: string]: unknown;
}

export interface CompileCtx {
  tz: string; // IANA zone, e.g. "Asia/Kathmandu" — day boundaries are computed from this, never server-local time
  now: Date; // injected, never Date.now() inside the compiler — keeps date tests deterministic
  industryId: string | null;
  permissions: ResolvedPermissions;
}

export interface FieldDef {
  key: string; // registry key referenced by FilterCondition.field
  label: string;
  type: FilterFieldType;
  source: FieldSource;
  operators?: FilterOperator[]; // overrides OPERATORS_BY_TYPE[type] when present
  options?: { value: string; label: string }[];
  emptyIsBlankString?: boolean; // text field where "" and NULL are both "empty"
  industries?: string[]; // undefined = all industries
  group: string; // UI grouping label ("Basic", "Dates", "Custom", …)
  icon?: string; // lucide icon name as a STRING (never a component import)
  filterable: boolean;
  // Exists for compilation/compat only (e.g. the legacy `?created=` URL path)
  // — never offered in FilterFieldPicker. Still fully filterable/compilable;
  // this only affects manual "+ Add filter" selection.
  hiddenFromPicker?: boolean;
  sortable?: boolean;
  sortColumns?: string[]; // multi-column sort (e.g. first_name -> [first_name, last_name])
  columnKey?: string; // back-reference into a rendering columns-registry
  accessor?: string;
  visibleTo?: (p: ResolvedPermissions) => boolean;
}

export type FieldRegistry = Record<string, FieldDef>;

export class FilterCompileError extends Error {
  constructor(
    message: string,
    public readonly code: "unknown_field" | "not_filterable" | "operator_not_allowed" | "invalid_value" | "unsupported"
  ) {
    super(message);
    this.name = "FilterCompileError";
  }
}

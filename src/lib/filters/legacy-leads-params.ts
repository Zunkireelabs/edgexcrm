import type { FilterCondition, FilterTree } from "./types";

// Converts the ~9 existing /api/v1/leads toolbar params into a FilterTree —
// the whole de-duplication strategy (see docs/ADVANCED-FILTERS-BRIEF.md). Once
// a route builds a tree from either `?f=` or these legacy params and runs both
// through the same compileFilter(), the existing route.test.ts suite becomes a
// full-fidelity regression harness for the compiler against real production
// semantics.
//
// Field keys here ("status", "search", "tags", …) are REGISTRY keys, resolved
// against whatever FieldRegistry a later phase supplies — this module does not
// own or import a registry itself (there isn't one yet in Phase 1).
//
// SCOPE PARAMS ARE NEVER INCLUDED. `list`, `funnel`, `stage`, `branch_id`,
// `assigned_to` (singular — scope), `include_converted`, `page`, `pageSize`,
// `count`, `sort`, `order`, `facets` are applied by the route as query SCOPE,
// not as filter conditions. In particular the pipeline allow-list must stay a
// route-applied predicate so `pipelineAccess.ids === []` keeps failing closed
// (`.in("pipeline_id", [])` -> 0 rows) — folding it into the tree would risk an
// "optimize away empty .in()" refactor silently leaking the tenant. Note that
// `assignees` (plural, CSV, may include the literal token "unassigned") is a
// DIFFERENT param from the scope-only `assigned_to` and IS a toolbar filter.

const CREATED_WINDOW_TO_RELATIVE: Record<string, string> = {
  today: "1d",
  week: "7d",
  month: "30d",
};

function csv(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function condition(id: string, field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition {
  return value === undefined ? { id, field, op } : { id, field, op, value };
}

export function legacyLeadsParamsToTree(sp: URLSearchParams): FilterTree {
  const conditions: FilterCondition[] = [];

  const status = sp.get("status");
  if (status && status !== "all") {
    conditions.push(condition("legacy:status", "status", "is", status));
  }

  const search = sp.get("search");
  if (search && search.trim()) {
    conditions.push(condition("legacy:search", "search", "contains", search.trim()));
  }

  const form = sp.get("form");
  if (form && form !== "all") {
    conditions.push(condition("legacy:form", "form", "is", form));
  }

  const tag = sp.get("tag");
  if (tag && tag !== "all") {
    conditions.push(condition("legacy:tag", "tags", "has_all", [tag]));
  }

  const created = sp.get("created");
  if (created && created !== "all" && CREATED_WINDOW_TO_RELATIVE[created]) {
    conditions.push(condition("legacy:created", "created", "within_last", CREATED_WINDOW_TO_RELATIVE[created]));
  }

  const industry = sp.get("industry");
  if (industry && industry !== "all") {
    if (industry === "__none__") {
      conditions.push(condition("legacy:industry", "industry", "is_empty"));
    } else {
      conditions.push(condition("legacy:industry", "industry", "is", industry));
    }
  }

  const source = csv(sp.get("source"));
  if (source.length > 0) {
    conditions.push(condition("legacy:source", "source", "is_any_of", source));
  }

  const assignees = csv(sp.get("assignees"));
  if (assignees.length > 0) {
    conditions.push(condition("legacy:assignees", "assignees", "is_any_of", assignees));
  }

  const collaborators = csv(sp.get("collaborators"));
  if (collaborators.length > 0) {
    conditions.push(condition("legacy:collaborators", "collaborators", "is_any_of", collaborators));
  }

  return { conjunction: "and", conditions };
}

// ADVANCED-FILTERS-BRIEF Phase 3 addendum §E — pulled forward from Phase 5.
//
// Phase 2 made the leads route skip facet counts entirely (`counts: null`) whenever
// `?f=` is present, rather than risk passing a PARTIAL translation of the tree into
// `lead_aggregates()` — which would produce a facet with subtly WRONG counts (worse
// than no counts at all). This module is the narrow, additive fix: it recognizes the
// one shape that IS safely translatable — a pure-AND tree whose every condition maps
// onto an existing `lead_aggregates()` param (migration 194) — and returns `ok: false`
// for anything else (any OR group, any operator/field the RPC can't express).
//
// Deliberately conservative. `lead_aggregates()` has a fixed, narrow param list (no
// `p_status_ne`, no `p_source_eq`, no multi-tag `p_tags_any`, no `p_created_before`) —
// every branch below either maps to an exact RPC param or falls through to `ok: false`.
// NEVER partially translate a condition (e.g. take a value and silently drop an
// operator's real semantics) — wrong counts are worse than absent counts.

import type { FieldRegistry, FilterCondition, FilterTree } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "7d" | "30d" | "3m" | "1y" — same vocabulary the FilterOperator doc comment
// (types.ts) documents for within_last/within_next.
const WITHIN_LAST_RE = /^(\d+)(d|m|y)$/;

function withinLastToDate(raw: string, now: Date): Date | null {
  const match = WITHIN_LAST_RE.exec(raw);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const result = new Date(now);
  if (unit === "d") result.setDate(result.getDate() - amount);
  else if (unit === "m") result.setMonth(result.getMonth() - amount);
  else result.setFullYear(result.getFullYear() - amount);
  return result;
}

function asList(value: FilterCondition["value"]): string[] {
  if (Array.isArray(value)) return value as string[];
  return value === undefined ? [] : [String(value)];
}

/** The subset of SourceFacetParams (src/lib/leads/aggregates.ts) this module can
 * populate. Named locally rather than imported to keep this file's dependency
 * surface to `./types` only — aggregates.ts sits outside src/lib/filters/. The
 * route maps these fields onto the real SourceFacetParams it already builds. */
export interface LeadAggregateFilterParams {
  status?: string;
  assigneesAny?: string[];
  includeUnassigned?: boolean;
  collaboratorIds?: string[];
  tag?: string;
  prospectIndustry?: string;
  formConfigId?: string;
  createdAfter?: Date;
}

export type TreeToAggregateParamsResult =
  | { ok: true; params: LeadAggregateFilterParams }
  | { ok: false; reason: string };

/**
 * Translate a filter tree into `lead_aggregates()` params, or explain why it can't be
 * done. `now` drives `within_last` — accepted as a parameter (rather than read off
 * Date.now()) for the same determinism reason CompileCtx.now is injected in compile.ts.
 */
export function treeToAggregateParams(
  tree: FilterTree,
  registry: FieldRegistry,
  now: Date
): TreeToAggregateParamsResult {
  if (tree.conjunction === "or") {
    return { ok: false, reason: "root conjunction is OR" };
  }
  if (tree.groups && tree.groups.length > 0) {
    return { ok: false, reason: "tree has OR sub-groups" };
  }

  const params: LeadAggregateFilterParams = {};
  const seenKeys = new Set<keyof LeadAggregateFilterParams>();

  const setOnce = (key: keyof LeadAggregateFilterParams, apply: () => void): TreeToAggregateParamsResult | null => {
    if (seenKeys.has(key)) {
      return { ok: false, reason: `duplicate condition on the same aggregate axis (${key})` };
    }
    seenKeys.add(key);
    apply();
    return null;
  };

  for (const cond of tree.conditions) {
    const field = registry[cond.field];
    if (!field || !field.filterable) {
      return { ok: false, reason: `unknown or non-filterable field "${cond.field}"` };
    }

    // Any of these are never expressible against the RPC's fixed param list, whatever
    // the field — is_empty/is_not_empty/contains-family all lack a matching param.
    if (
      cond.op === "is_empty" ||
      cond.op === "is_not_empty" ||
      cond.op === "contains" ||
      cond.op === "not_contains" ||
      cond.op === "starts_with" ||
      cond.op === "ends_with"
    ) {
      return { ok: false, reason: `operator "${cond.op}" has no lead_aggregates() equivalent` };
    }

    let err: TreeToAggregateParamsResult | null = null;

    switch (cond.field) {
      case "status":
        if (cond.op !== "is") return { ok: false, reason: `status: only "is" is expressible (got "${cond.op}")` };
        err = setOnce("status", () => { params.status = String(cond.value); });
        break;

      case "assignees": {
        if (cond.op !== "is_any_of") return { ok: false, reason: `assignees: only "is_any_of" is expressible (got "${cond.op}")` };
        const values = asList(cond.value);
        const ids = values.filter((v) => v !== "unassigned" && UUID_RE.test(v));
        const wantsUnassigned = values.includes("unassigned");
        err = setOnce("assigneesAny", () => {
          if (ids.length > 0) params.assigneesAny = ids;
          if (wantsUnassigned) params.includeUnassigned = true;
        });
        break;
      }

      case "collaborators": {
        if (cond.op !== "is_any_of") return { ok: false, reason: `collaborators: only "is_any_of" is expressible (got "${cond.op}")` };
        const ids = asList(cond.value).filter((v) => UUID_RE.test(v));
        if (ids.length === 0) return { ok: false, reason: "collaborators: no valid uuid values" };
        err = setOnce("collaboratorIds", () => { params.collaboratorIds = ids; });
        break;
      }

      case "tags": {
        if (cond.op !== "has_all") return { ok: false, reason: `tags: only single-value "has_all" is expressible (got "${cond.op}")` };
        const values = asList(cond.value);
        // p_tag is a single value (`tags @> ARRAY[p_tag]`) — a multi-tag has_all has
        // no matching AND-of-N-tags param on the RPC.
        if (values.length !== 1) return { ok: false, reason: "tags: only a single-tag has_all is expressible" };
        err = setOnce("tag", () => { params.tag = values[0]; });
        break;
      }

      case "industry":
        if (cond.op !== "is") return { ok: false, reason: `industry: only "is" is expressible (got "${cond.op}")` };
        err = setOnce("prospectIndustry", () => { params.prospectIndustry = String(cond.value); });
        break;

      case "form": {
        if (cond.op !== "is") return { ok: false, reason: `form: only "is" is expressible (got "${cond.op}")` };
        const value = String(cond.value);
        if (!UUID_RE.test(value)) return { ok: false, reason: "form: value is not a uuid" };
        err = setOnce("formConfigId", () => { params.formConfigId = value; });
        break;
      }

      case "created":
      case "created_at": {
        if (cond.op === "after") {
          err = setOnce("createdAfter", () => { params.createdAfter = new Date(String(cond.value)); });
        } else if (cond.op === "within_last") {
          const resolved = withinLastToDate(String(cond.value), now);
          if (!resolved) return { ok: false, reason: `created: unparseable within_last value "${String(cond.value)}"` };
          err = setOnce("createdAfter", () => { params.createdAfter = resolved; });
        } else {
          return { ok: false, reason: `created: only "after"/"within_last" are expressible (got "${cond.op}")` };
        }
        break;
      }

      default:
        return { ok: false, reason: `field "${cond.field}" has no lead_aggregates() equivalent` };
    }

    if (err) return err;
  }

  return { ok: true, params };
}

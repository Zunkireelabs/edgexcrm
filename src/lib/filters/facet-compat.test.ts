import { describe, it, expect } from "vitest";
import { compileFilter, planFilter, type QueryBuilder } from "./compile";
import { treeForFacetOption } from "./facet-tree";
import { leadFields } from "./registry/leads";
import { OPERATORS_BY_TYPE } from "./operators";
import type { CompileCtx, FieldDef, FilterCondition, FilterFieldType, FilterOperator, FilterTree, FilterValue } from "./types";

// THE per-field guard behind "pick a filter, then open a people-picker, and it goes empty".
//
// That bug happened because the old counting path only understood a short whitelist of filter
// fields (status, assignees, tags, …) — pick anything else (Intake, Field of study, Destinations,
// Stage, search…) and the picker's counts silently switched off. Facet counts are now the list's
// own query with the picker's axis swapped for one person (route.ts + facet-tree.ts), so ANY
// filterable field must keep working underneath a facet. This test enforces that for EVERY
// filterable field × every operator it offers, in every industry that can see it — so a field
// added tomorrow is covered automatically, and one that can't be faceted fails the build.

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PERSON = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// Chainable no-op builder: records nothing, accepts every PostgREST method compileFilter may call.
function noopBuilder(): QueryBuilder {
  const proxy: unknown = new Proxy(function () {}, { get: () => () => proxy, apply: () => proxy });
  return proxy as QueryBuilder;
}

function ctx(industryId: string): CompileCtx {
  return { tz: "UTC", now: new Date("2026-09-30T00:00:00Z"), industryId, permissions: {} };
}

/** A syntactically valid sample value for (field type, operator); undefined = the op takes none. */
function sampleValue(type: FilterFieldType, op: FilterOperator): FilterValue | undefined {
  switch (op) {
    case "is_empty":
    case "is_not_empty":
    case "is_true":
    case "is_false":
      return undefined;
    case "is_any_of":
    case "is_none_of":
    case "has_all":
      return [type === "uuid" ? UUID : "x"];
    case "between":
      return type === "date" ? ["2026-01-01", "2026-02-01"] : [1, 2];
    case "date_between":
      return ["2026-01-01", "2026-02-01"];
    case "within_last":
    case "within_next":
      return "7d";
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return type === "date" ? "2026-01-01" : 1;
    case "before":
    case "after":
    case "on":
      return "2026-01-01";
    case "contains":
    case "not_contains":
    case "starts_with":
    case "ends_with":
      return "x";
    default: // is / is_not
      if (type === "uuid") return UUID;
      if (type === "number") return 1;
      if (type === "date") return "2026-01-01";
      return "x";
  }
}

const KNOWN_TYPES: FilterFieldType[] = ["text", "number", "date", "boolean", "select", "multiselect", "uuid", "tags", "relation"];

describe.each(["education_consultancy", "it_agency"])("facet compatibility — every filterable lead field (%s)", (industryId) => {
  const context = ctx(industryId);
  const registry = leadFields(context);
  // Industry-gated fields (e.g. Intake / Field of study / Destinations are education-only) don't exist
  // for other industries — the compiler rejects them there by design — so test each industry only
  // against the fields it can actually use.
  const fields = Object.values(registry).filter(
    (f: FieldDef) => f.filterable && (!f.industries || f.industries.includes(industryId)),
  );

  it("has filterable fields to test (guards against the registry silently emptying)", () => {
    expect(fields.length).toBeGreaterThan(10);
  });

  it("only uses field types this test has sample values for — a NEW type must be added here on purpose", () => {
    for (const f of fields) expect(KNOWN_TYPES).toContain(f.type);
  });

  for (const field of fields) {
    const ops = field.operators ?? OPERATORS_BY_TYPE[field.type] ?? [];

    it(`${field.key}: works as the BASE filter under a collaborator and an assignee facet, for every operator`, () => {
      let exercised = 0;
      for (const op of ops) {
        const value = sampleValue(field.type, op);
        const condition: FilterCondition = value === undefined ? { id: "c", field: field.key, op } : { id: "c", field: field.key, op, value };
        const base: FilterTree = { conjunction: "and", conditions: [condition] };

        // Only combos the LIST itself accepts are meaningful (a sample the compiler rejects for
        // its own reasons — e.g. an option-constrained select — says nothing about facets).
        if (!planFilter(base, registry, context).ok) continue;
        exercised++;

        for (const axis of ["collaborators", "assignees"] as const) {
          const facetTree = treeForFacetOption(base, axis, PERSON);
          // The facet path must be able to express it…
          expect(facetTree, `${field.key} ${op} → ${axis} facet tree`).not.toBeNull();
          // …plan it (the route THROWS → 503 if it can't)…
          const plan = planFilter(facetTree!, registry, context);
          expect(plan.ok, `${field.key} ${op} → ${axis} facet plan`).toBe(true);
          // …and compile it without error.
          expect(() => compileFilter(noopBuilder(), facetTree!, registry, context)).not.toThrow();
        }
      }
      // A field whose every operator got skipped would be silently untested.
      expect(exercised, `${field.key}: no operator produced a plannable sample — extend sampleValue()`).toBeGreaterThan(0);
    });
  }
});

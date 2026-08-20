import { describe, it, expect } from "vitest";
import { compileFilter, planFilter, type QueryBuilder } from "../compile";
import { FilterCompileError, type CompileCtx, type FilterCondition, type FilterTree } from "../types";
import { leadFields } from "./leads";

// Spot-checks that the leads registry's legacy-facing fields (status, source,
// assignees) compile to the SAME predicate route.ts's hand-rolled chain emits
// today. status/source are strict single-column (status / intake_source) —
// see the doc comment at the top of leads.ts for why value-shape dispatch was
// tried and reverted.

class FakeBuilder implements QueryBuilder {
  calls: string[] = [];
  private record(entry: string): this {
    this.calls.push(entry);
    return this;
  }
  eq(c: string, v: unknown): this {
    return this.record(`eq(${c},${JSON.stringify(v)})`);
  }
  neq(c: string, v: unknown): this {
    return this.record(`neq(${c},${JSON.stringify(v)})`);
  }
  is(c: string, v: null | boolean): this {
    return this.record(`is(${c},${JSON.stringify(v)})`);
  }
  in(c: string, vs: readonly unknown[]): this {
    return this.record(`in(${c},${JSON.stringify(vs)})`);
  }
  gt(c: string, v: unknown): this {
    return this.record(`gt(${c},${JSON.stringify(v)})`);
  }
  gte(c: string, v: unknown): this {
    return this.record(`gte(${c},${JSON.stringify(v)})`);
  }
  lt(c: string, v: unknown): this {
    return this.record(`lt(${c},${JSON.stringify(v)})`);
  }
  lte(c: string, v: unknown): this {
    return this.record(`lte(${c},${JSON.stringify(v)})`);
  }
  ilike(c: string, p: string): this {
    return this.record(`ilike(${c},${p})`);
  }
  contains(c: string, v: readonly unknown[] | Record<string, unknown>): this {
    return this.record(`contains(${c},${JSON.stringify(v)})`);
  }
  overlaps(c: string, v: readonly unknown[]): this {
    return this.record(`overlaps(${c},${JSON.stringify(v)})`);
  }
  not(c: string, op: string, v: unknown): this {
    return this.record(`not(${c},${op},${JSON.stringify(v)})`);
  }
  or(f: string): this {
    return this.record(`or(${f})`);
  }
}

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-01-15T12:00:00.000Z"), industryId: null, permissions: {} };
const registry = leadFields(ctx);

function cond(id: string, field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition {
  return value === undefined ? { id, field, op } : { id, field, op, value };
}

function andTree(...conditions: FilterCondition[]): FilterTree {
  return { conjunction: "and", conditions };
}

function compile(tree: FilterTree): FakeBuilder {
  return compileFilter(new FakeBuilder(), tree, registry, ctx);
}

describe("leads registry — legacy value-shape equivalence", () => {
  it("status: a text slug (never a UUID from the legacy toolbar) targets the status column, matching route.ts's .eq('status', value)", () => {
    const b = compile(andTree(cond("c1", "status", "is", "contacted")));
    expect(b.calls).toEqual(["or(status.eq.contacted)"]);
  });

  it("source: a text slug list targets intake_source, matching route.ts's .in('intake_source', sourceFilter)", () => {
    const b = compile(andTree(cond("c1", "source", "is_any_of", ["google_ads", "referral"])));
    expect(b.calls).toEqual(["or(intake_source.in.(google_ads,referral))"]);
  });

  it("status: a UUID-shaped value still targets status (no stage_id dispatch), matching route.ts's .eq('status', value)", () => {
    const b = compile(andTree(cond("c1", "status", "is", "11111111-2222-4333-8444-555555555555")));
    expect(b.calls).toEqual(["or(status.eq.11111111-2222-4333-8444-555555555555)"]);
  });

  it("source: a UUID-shaped value still targets intake_source (no form_config_id dispatch)", () => {
    const b = compile(andTree(cond("c1", "source", "is_any_of", ["11111111-2222-4333-8444-555555555555"])));
    expect(b.calls).toEqual(["or(intake_source.eq.11111111-2222-4333-8444-555555555555)"]);
  });

  it("source: an empty value list throws instead of compiling to a silent match-everything predicate (R12 fail-closed)", () => {
    const source = registry.source.source;
    if (source.kind !== "virtual") throw new Error("expected virtual source");
    expect(() => source.compile({ id: "c1", field: "source", op: "is_any_of", value: [] }, ctx)).toThrow(FilterCompileError);
    expect(() => source.compile({ id: "c1", field: "source", op: "is_none_of", value: [] }, ctx)).toThrow(FilterCompileError);
  });

  it("form: a UUID targets form_config_id directly, matching route.ts's .eq('form_config_id', formFilter)", () => {
    const b = compile(andTree(cond("c1", "form", "is", "11111111-2222-4333-8444-555555555555")));
    expect(b.calls).toEqual(["eq(form_config_id,\"11111111-2222-4333-8444-555555555555\")"]);
  });

  it("assignees: unassigned + ids matches route.ts's or(assigned_to.is.null,assigned_to.in.(...))", () => {
    const b = compile(andTree(cond("c1", "assignees", "is_any_of", ["unassigned", "11111111-2222-4333-8444-555555555555"])));
    expect(b.calls).toEqual(["or(or(assigned_to.is.null,assigned_to.in.(11111111-2222-4333-8444-555555555555)))"]);
  });

  it("assignees: only unassigned matches route.ts's .is('assigned_to', null)", () => {
    const b = compile(andTree(cond("c1", "assignees", "is_any_of", ["unassigned"])));
    expect(b.calls).toEqual(["or(assigned_to.is.null)"]);
  });

  it("assignees: every token invalid and no 'unassigned' falls through to no filter, matching route.ts's silent no-op", () => {
    const b = compile(andTree(cond("c1", "assignees", "is_any_of", ["garbage"])));
    // §0 fix: dropped, not compiled to the tautology "id.not.is.null" — see
    // compile.test.ts's "or(<dropped>, X)" coverage for why that matters once
    // this condition can land inside an OR group.
    expect(b.calls).toEqual([]);
  });

  it("assignees: is_empty compiles to a plain assigned_to.is.null check (no !inner-join trap — assigned_to is a scalar column)", () => {
    const b = compile(andTree(cond("c1", "assignees", "is_empty")));
    expect(b.calls).toEqual(["or(assigned_to.is.null)"]);
  });

  it("assignees: is_not_empty compiles to assigned_to.not.is.null", () => {
    const b = compile(andTree(cond("c1", "assignees", "is_not_empty")));
    expect(b.calls).toEqual(["or(assigned_to.not.is.null)"]);
  });

  it("assignees: every token invalid, inside an OR group, drops out rather than making the group match every row (§0 fix)", () => {
    const b = compile({
      conjunction: "and",
      conditions: [],
      groups: [{ conjunction: "or", conditions: [cond("c1", "assignees", "is_any_of", ["garbage"]), cond("c2", "status", "is", "contacted")] }],
    });
    expect(b.calls).toEqual(["or(status.eq.contacted)"]);
  });

  it("collaborators is embed-kind and is planned as the exact !inner select route.ts's selectColumns ternary builds today", () => {
    const plan = planFilter(andTree(cond("c1", "collaborators", "is_any_of", ["u1"])), registry, ctx);
    expect(plan).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
  });

  it("collaborators: is_not_empty is safe on the !inner join (any surviving row already has >=1 collaborator) and still carries referencedTable", () => {
    const plan = planFilter(andTree(cond("c1", "collaborators", "is_not_empty")), registry, ctx);
    expect(plan).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
  });

  it("collaborators: is_empty is rejected at the registry level — the !inner join can't express 'no matching row' (would silently compile to zero-rows-always, same fix class as is_none_of)", () => {
    const plan = planFilter(andTree(cond("c1", "collaborators", "is_empty")), registry, ctx);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.errors.collaborators?.[0]).toMatch(/operator is_empty is not allowed/);
  });

  it("tags has_all matches route.ts's .contains('tags', [tagFilter]) via the native path", () => {
    const b = compile(andTree(cond("c1", "tags", "has_all", ["vip"])));
    expect(b.calls).toEqual(['contains(tags,["vip"])']);
  });

  it("industry __none__ (is_empty) matches route.ts's .is('prospect_industry', null) via the native path", () => {
    const b = compile(andTree(cond("c1", "industry", "is_empty")));
    expect(b.calls).toEqual(["is(prospect_industry,null)"]);
  });

  it("data_completeness / next_task / assigned_role are not filterable in Phase 2", () => {
    for (const key of ["data_completeness", "next_task", "assigned_role"]) {
      const plan = planFilter(andTree(cond("c1", key, "is", "x")), registry, ctx);
      expect(plan.ok).toBe(false);
    }
  });

  it("SORT_COLUMNS is folded in: created_at/last_activity_at/updated_at/first_name/email all carry sortColumns", () => {
    expect(registry.created_at.sortColumns).toEqual(["created_at"]);
    expect(registry.last_activity_at.sortColumns).toEqual(["last_activity_at"]);
    expect(registry.updated_at.sortColumns).toEqual(["updated_at"]);
    expect(registry.first_name.sortColumns).toEqual(["first_name", "last_name"]);
    expect(registry.email.sortColumns).toEqual(["email"]);
  });

  it('"created" is hidden from the manual picker but stays fully filterable — the legacy ?created= URL path (legacy-leads-params.ts) still resolves through it', () => {
    expect(registry.created.filterable).toBe(true);
    expect(registry.created.hiddenFromPicker).toBe(true);
    expect(registry.created_at.hiddenFromPicker).toBeUndefined();
  });
});

describe("location — city+country combined virtual field", () => {
  it('"is_empty" requires BOTH city and country to be blank (NULL or "") — matches the blank-string-inclusive semantics city/country each have individually', () => {
    const b = compile(andTree(cond("c1", "location", "is_empty")));
    expect(b.calls[0]).toBe('or(and(or(city.is.null,city.eq.""),or(country.is.null,country.eq."")))');
  });

  it('"is_not_empty" matches if EITHER city or country has real (non-null, non-blank) data', () => {
    const b = compile(andTree(cond("c1", "location", "is_not_empty")));
    expect(b.calls[0]).toBe('or(or(and(city.not.is.null,city.neq.""),and(country.not.is.null,country.neq."")))');
  });

  it("a row with city='' (blank string, not NULL) is still reported empty — matches filtering city directly (emptyIsBlankString: true)", () => {
    const cityEmpty = compile(andTree(cond("c1", "city", "is_empty")));
    const locationEmpty = compile(andTree(cond("c1", "location", "is_empty")));
    expect(cityEmpty.calls[0]).toContain('city.eq.""');
    expect(locationEmpty.calls[0]).toContain('city.eq.""');
  });
});

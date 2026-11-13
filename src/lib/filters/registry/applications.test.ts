import { describe, expect, it } from "vitest";
import { compileFilter, planFilter, type QueryBuilder } from "../compile";
import type { CompileCtx, FilterCondition, FilterTree } from "../types";
import { applicationFields, CROSS_TABLE_KEYS } from "./applications";

class FakeBuilder implements QueryBuilder {
  calls: string[] = [];
  private rec(s: string): this {
    this.calls.push(s);
    return this;
  }
  eq(c: string, v: unknown) { return this.rec(`eq(${c},${JSON.stringify(v)})`); }
  neq(c: string, v: unknown) { return this.rec(`neq(${c},${JSON.stringify(v)})`); }
  is(c: string, v: null | boolean) { return this.rec(`is(${c},${JSON.stringify(v)})`); }
  in(c: string, v: readonly unknown[]) { return this.rec(`in(${c},${JSON.stringify(v)})`); }
  gt(c: string, v: unknown) { return this.rec(`gt(${c},${v})`); }
  gte(c: string, v: unknown) { return this.rec(`gte(${c},${v})`); }
  lt(c: string, v: unknown) { return this.rec(`lt(${c},${v})`); }
  lte(c: string, v: unknown) { return this.rec(`lte(${c},${v})`); }
  ilike(c: string, p: string) { return this.rec(`ilike(${c},${p})`); }
  contains(c: string, v: readonly unknown[] | Record<string, unknown>) { return this.rec(`contains(${c},${JSON.stringify(v)})`); }
  overlaps(c: string, v: readonly unknown[]) { return this.rec(`overlaps(${c},${JSON.stringify(v)})`); }
  not(c: string, o: string, v: unknown) { return this.rec(`not(${c},${o},${JSON.stringify(v)})`); }
  or(f: string) { return this.rec(`or(${f})`); }
}

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-01-15T12:00:00.000Z"), industryId: "education_consultancy", permissions: {} };
const reg = applicationFields(ctx);
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

function compile(field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): string {
  const b = new FakeBuilder();
  const tree: FilterTree = { conjunction: "and", conditions: [{ id: "c", field, op, value } as FilterCondition] };
  compileFilter(b, tree, reg, ctx);
  return b.calls.join(" | ");
}

const CASES: [string, FilterCondition["op"], FilterCondition["value"] | undefined, string][] = [
  ["stage", "is", U1, `eq(stage_id,"${U1}")`],
  ["stage", "is_any_of", [U1, U2], `in(stage_id,["${U1}","${U2}"])`],
  ["stage", "is_not", U1, `or(or(stage_id.is.null,stage_id.neq.${U1}))`],
  ["stage", "is_none_of", [U1, U2], `or(or(stage_id.is.null,stage_id.not.in.(${U1},${U2})))`],
  ["intake", "is", "Fall 2026", `eq(intake_term,"Fall 2026")`],
  ["intake", "is_not", "Fall 2026", `or(or(intake_term.is.null,intake_term.neq."Fall 2026"))`],
  ["intake", "is_any_of", ["a", "b"], `in(intake_term,["a","b"])`],
  ["intake", "is_none_of", ["a", "b"], `or(or(intake_term.is.null,intake_term.not.in.(a,b)))`],
  ["intake", "is_empty", undefined, `is(intake_term,null)`],
  ["intake", "is_not_empty", undefined, `not(intake_term,is,null)`],
  ["university", "contains", "har", `ilike(university_name,%har%)`],
  ["university", "not_contains", "har", `or(or(university_name.is.null,university_name.not.ilike.%har%))`],
  ["university", "is", "Harvard", `eq(university_name,"Harvard")`],
  ["university", "is_not", "Harvard", `or(or(university_name.is.null,university_name.neq.Harvard))`],
  ["university", "starts_with", "H", `ilike(university_name,H%)`],
  ["university", "ends_with", "d", `ilike(university_name,%d)`],
  ["program", "contains", "law", `ilike(program_name,%law%)`],
  ["program", "not_contains", "law", `or(or(program_name.is.null,program_name.not.ilike.%law%))`],
  ["program", "is_empty", undefined, `or(or(program_name.is.null,program_name.eq.""))`],
  ["program", "is_not_empty", undefined, `or(and(program_name.not.is.null,program_name.neq.""))`],
  ["country", "is_any_of", ["UK", "USA"], `overlaps(countries,["UK","USA"])`],
  ["country", "is_none_of", ["UK"], `or(or(countries.is.null,countries.not.ov.{UK}))`],
  ["country", "has_all", ["UK", "USA"], `contains(countries,["UK","USA"])`],
  ["country", "is_empty", undefined, `or(or(countries.is.null,countries.eq.{}))`],
  ["country", "is_not_empty", undefined, `or(and(countries.not.is.null,countries.neq.{}))`],
  ["offer_type", "is", "conditional", `eq(offer_type,"conditional")`],
  ["offer_type", "is_not", "conditional", `or(or(offer_type.is.null,offer_type.neq.conditional))`],
  ["offer_type", "is_empty", undefined, `is(offer_type,null)`],
  ["deadline", "before", "2026-02-01", `or(application_deadline.lt."2026-02-01T00:00:00.000Z")`],
  ["deadline", "after", "2026-02-01", `or(application_deadline.gte."2026-02-02T00:00:00.000Z")`],
  ["deadline", "is_empty", undefined, `or(application_deadline.is.null)`],
  ["deadline", "is_not_empty", undefined, `or(application_deadline.not.is.null)`],
  ["fee_paid", "is_true", undefined, `eq(application_fee_paid,true)`],
  ["fee_paid", "is_false", undefined, `eq(application_fee_paid,false)`],
  ["time_in_stage", "before", "2025-12-01", `or(stage_changed_at.lt."2025-12-01T00:00:00.000Z")`],
  ["time_in_stage", "within_last", "7d", `or(and(stage_changed_at.gte."2026-01-08T12:00:00.000Z",stage_changed_at.lte."2026-01-15T12:00:00.000Z"))`],
  ["created_at", "on", "2026-01-10", `or(and(created_at.gte."2026-01-10T00:00:00.000Z",created_at.lt."2026-01-11T00:00:00.000Z"))`],
  ["updated_at", "within_last", "30d", `or(and(updated_at.gte."2025-12-16T12:00:00.000Z",updated_at.lte."2026-01-15T12:00:00.000Z"))`],
];

describe("applications registry compile strings", () => {
  it.each(CASES)("%s %s", (field, op, value, expected) => {
    expect(compile(field, op, value)).toBe(expected);
  });

  it("negations include NULL rows (no bare <>)", () => {
    for (const [field, op, value] of CASES.filter((c) => ["is_not", "not_contains", "is_none_of"].includes(c[1]))) {
      expect(compile(field, op, value), `${field} ${op}`).toMatch(/is\.null/);
    }
  });

  it.each(CROSS_TABLE_KEYS)("%s compiles to nothing through compileFilter (the query helper owns it)", (field) => {
    const op = field === "counsellor" ? "is" : "contains";
    expect(compile(field, op, field === "counsellor" ? U1 : "x")).toBe("");
  });

  it("the 'student' field offers only contains; 'Missing documents' is not a field", () => {
    expect(reg.student.operators).toEqual(["contains"]);
    expect(reg.missing_documents).toBeUndefined();
  });

  it("the search field is hidden from the picker; every picker field is filterable", () => {
    expect(reg.search.hiddenFromPicker).toBe(true);
    for (const f of Object.values(reg)) expect(f.filterable).toBe(true);
  });

  it("rejects a tenant outside education_consultancy", () => {
    const plan = planFilter({ conjunction: "and", conditions: [{ id: "c", field: "intake", op: "is_empty" }] }, reg, { ...ctx, industryId: "it_agency" });
    expect(plan.ok).toBe(false);
  });
});

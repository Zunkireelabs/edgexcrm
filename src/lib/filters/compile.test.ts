import { describe, it, expect } from "vitest";
import { compileFilter, planFilter, type QueryBuilder } from "./compile";
import { FilterCompileError, type CompileCtx, type FieldRegistry, type FilterCondition, type FilterTree } from "./types";

// ── Fake builder ─────────────────────────────────────────────────────────
// Deliberately implements ONLY the QueryBuilder interface — no from()/
// select()/rpc() exist on it at all, so any accidental call to one of those
// inside compileFilter would be a TypeScript compile error, not just a test
// failure. Every call is recorded verbatim so tests can assert exactly which
// path (native builder call vs. constructed .or() string) fired.
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
  // Parallel to `calls` — one entry per `.or()` call, tracking the
  // `referencedTable` option (undefined when omitted). A real postgrest-js
  // builder REQUIRES this option to filter an embedded/joined resource
  // (e.g. lead_collaborators) — baking the table name into the filter
  // string instead, with no referencedTable, is the exact bug that shipped
  // to production (PGRST100 "failed to parse logic tree"). Kept separate
  // from `calls`/`orPayloads()` so every pre-existing non-embed test's
  // assertions on the plain filter string stay unchanged.
  orReferencedTables: (string | undefined)[] = [];
  or(f: string, opts?: { referencedTable?: string }): this {
    this.orReferencedTables.push(opts?.referencedTable);
    return this.record(`or(${f})`);
  }

  orPayloads(): string[] {
    return this.calls.filter((c) => c.startsWith("or(")).map((c) => c.slice(3, -1));
  }
}

// ── Fixture registry — one FieldDef per FieldSource kind ────────────────
const registry: FieldRegistry = {
  first_name: { key: "first_name", label: "First name", type: "text", source: { kind: "column", column: "first_name" }, group: "Basic", filterable: true },
  age: { key: "age", label: "Age", type: "number", source: { kind: "column", column: "age" }, group: "Basic", filterable: true },
  created_at: { key: "created_at", label: "Created", type: "date", source: { kind: "column", column: "created_at" }, group: "Dates", filterable: true },
  is_active: { key: "is_active", label: "Active", type: "boolean", source: { kind: "column", column: "is_active" }, group: "Basic", filterable: true },
  industry: { key: "industry", label: "Industry", type: "select", source: { kind: "column", column: "prospect_industry" }, group: "Basic", filterable: true },
  assigned_to: { key: "assigned_to", label: "Assigned to", type: "uuid", source: { kind: "column", column: "assigned_to" }, group: "Basic", filterable: true },
  tags: { key: "tags", label: "Tags", type: "tags", source: { kind: "array_column", column: "tags" }, group: "Basic", filterable: true },
  note: { key: "note", label: "Note", type: "text", source: { kind: "jsonb", column: "custom_fields", path: "note" }, group: "Custom", filterable: true },
  field_of_study: {
    key: "field_of_study",
    label: "Field of study",
    type: "text",
    source: { kind: "promoted", column: "field_of_study", jsonb: { column: "custom_fields", path: "field_of_study" } },
    group: "Education",
    filterable: true,
  },
  destinations: {
    key: "destinations",
    label: "Destinations",
    type: "multiselect",
    source: { kind: "promoted", column: "destinations", jsonb: { column: "custom_fields", path: "countries" } },
    group: "Education",
    filterable: true,
  },
  search: {
    key: "search",
    label: "Search",
    type: "text",
    source: { kind: "columns", columns: ["first_name", "last_name"], fullNamePairs: true },
    group: "Basic",
    filterable: true,
  },
  collaborators: {
    key: "collaborators",
    label: "Collaborators",
    type: "relation",
    source: { kind: "embed", relation: "lead_collaborators", column: "user_id", embedSelect: "lead_collaborators!inner(user_id)" },
    group: "Basic",
    filterable: true,
  },
  // Same relation, but WITH the mig 210-style emptyColumn escape hatch wired
  // up — a distinct fixture (not a mutation of `collaborators` above) so both
  // "no emptyColumn configured" (rejected) and "emptyColumn configured"
  // (works, no join) stay independently testable.
  collaborators_with_count: {
    key: "collaborators_with_count",
    label: "Collaborators (with count)",
    type: "relation",
    source: {
      kind: "embed",
      relation: "lead_collaborators",
      column: "user_id",
      embedSelect: "lead_collaborators!inner(user_id)",
      emptyColumn: "collaborator_count",
    },
    operators: ["is_any_of", "is_not_empty", "is_empty"],
    group: "Basic",
    filterable: true,
  },
  status: {
    key: "status",
    label: "Status",
    type: "select",
    // key != column trap: stage_id if present, else the legacy `status` column.
    source: {
      kind: "virtual",
      compile: (c: FilterCondition) => {
        const val = String(c.value);
        if (c.op === "is") return `or(stage_id.eq.${val},and(stage_id.is.null,status.eq.${val}))`;
        if (c.op === "is_not")
          return `or(stage_id.is.null,and(stage_id.neq.${val},status.is.null),and(stage_id.is.null,status.is.null),and(stage_id.is.null,status.neq.${val}))`;
        throw new FilterCompileError(`status virtual field: unsupported op ${c.op}`, "unsupported");
      },
    },
    group: "Basic",
    filterable: true,
  },
  hidden: { key: "hidden", label: "Hidden", type: "text", source: { kind: "column", column: "secret" }, group: "Basic", filterable: false },
  // §0 fix fixture: a virtual field whose compile() can legitimately return
  // null — "contributes nothing" — for a specific value, mirroring
  // registry/leads.ts's compileAssignees("garbage").
  maybe_noop: {
    key: "maybe_noop",
    label: "Maybe no-op",
    type: "select",
    source: {
      kind: "virtual",
      compile: (c: FilterCondition) => (c.value === "noop" ? null : `some_col.eq.${String(c.value)}`),
    },
    operators: ["is"],
    group: "Basic",
    filterable: true,
  },
};

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-01-15T12:00:00.000Z"), industryId: null, permissions: {} };

function compile(tree: FilterTree): FakeBuilder {
  return compileFilter(new FakeBuilder(), tree, registry, ctx);
}

function cond(id: string, field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition {
  return value === undefined ? { id, field, op } : { id, field, op, value };
}

function andTree(...conditions: FilterCondition[]): FilterTree {
  return { conjunction: "and", conditions };
}

// ── Builder invariant ─────────────────────────────────────────────────────

describe("compileFilter builder invariant", () => {
  it("FakeBuilder has no from/select/rpc — a call to any of them would be a TS error, not a runtime one", () => {
    expect((new FakeBuilder() as unknown as Record<string, unknown>).from).toBeUndefined();
    expect((new FakeBuilder() as unknown as Record<string, unknown>).select).toBeUndefined();
    expect((new FakeBuilder() as unknown as Record<string, unknown>).rpc).toBeUndefined();
  });

  it("returns the SAME builder instance it was given (mutated, not replaced)", () => {
    const builder = new FakeBuilder();
    const result = compileFilter(builder, andTree(cond("c1", "first_name", "is", "Jane")), registry, ctx);
    expect(result).toBe(builder);
  });

  it("an empty tree makes zero calls", () => {
    const builder = compile(andTree());
    expect(builder.calls).toEqual([]);
  });
});

// ── Native fast path (pure AND, positive, single-column) ─────────────────

describe("native fast path — pure AND trees use builder calls, not .or() strings", () => {
  it('"is" -> eq()', () => {
    const b = compile(andTree(cond("c1", "first_name", "is", "Jane")));
    expect(b.calls).toEqual(['eq(first_name,"Jane")']);
  });

  it('"contains"/"starts_with"/"ends_with" -> ilike()', () => {
    expect(compile(andTree(cond("c1", "first_name", "contains", "an"))).calls).toEqual(["ilike(first_name,%an%)"]);
    expect(compile(andTree(cond("c1", "first_name", "starts_with", "Ja"))).calls).toEqual(["ilike(first_name,Ja%)"]);
    expect(compile(andTree(cond("c1", "first_name", "ends_with", "ne"))).calls).toEqual(["ilike(first_name,%ne)"]);
  });

  it('"gt"/"gte"/"lt"/"lte" -> respective builder methods', () => {
    expect(compile(andTree(cond("c1", "age", "gt", 18))).calls).toEqual(["gt(age,18)"]);
    expect(compile(andTree(cond("c1", "age", "gte", 18))).calls).toEqual(["gte(age,18)"]);
    expect(compile(andTree(cond("c1", "age", "lt", 65))).calls).toEqual(["lt(age,65)"]);
    expect(compile(andTree(cond("c1", "age", "lte", 65))).calls).toEqual(["lte(age,65)"]);
  });

  it('"between" -> chained gte().lte()', () => {
    const b = compile(andTree(cond("c1", "age", "between", [18, 65])));
    expect(b.calls).toEqual(["gte(age,18)", "lte(age,65)"]);
  });

  it('"is_any_of" on a scalar (uuid) field -> in()', () => {
    const b = compile(
      andTree(cond("c1", "assigned_to", "is_any_of", ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]))
    );
    expect(b.calls).toEqual(['in(assigned_to,["11111111-1111-1111-1111-111111111111","22222222-2222-2222-2222-222222222222"])']);
  });

  it('"is_any_of" on an array_column (tags) -> overlaps()', () => {
    const b = compile(andTree(cond("c1", "tags", "is_any_of", ["vip", "urgent"])));
    expect(b.calls).toEqual(['overlaps(tags,["vip","urgent"])']);
  });

  it('"has_all" on tags -> contains()', () => {
    const b = compile(andTree(cond("c1", "tags", "has_all", ["vip", "urgent"])));
    expect(b.calls).toEqual(['contains(tags,["vip","urgent"])']);
  });

  it('"is_true"/"is_false" -> eq(col, bool)', () => {
    expect(compile(andTree(cond("c1", "is_active", "is_true"))).calls).toEqual(["eq(is_active,true)"]);
    expect(compile(andTree(cond("c1", "is_active", "is_false"))).calls).toEqual(["eq(is_active,false)"]);
  });

  it('"is_empty"/"is_not_empty" on a NON-text, non-array field -> is()/not() single call', () => {
    expect(compile(andTree(cond("c1", "assigned_to", "is_empty"))).calls).toEqual(["is(assigned_to,null)"]);
    expect(compile(andTree(cond("c1", "assigned_to", "is_not_empty"))).calls).toEqual(['not(assigned_to,is,null)']);
  });

  it("multiple AND conditions all use native calls, chained", () => {
    const b = compile(andTree(cond("c1", "first_name", "is", "Jane"), cond("c2", "age", "gte", 18)));
    expect(b.calls).toEqual(['eq(first_name,"Jane")', "gte(age,18)"]);
    expect(b.orPayloads()).toEqual([]);
  });
});

// ── String path — conditions that need compound predicates ───────────────

describe("string path — conditions requiring compound predicates use .or()", () => {
  it('"is_empty" on TEXT includes the blank-string leg (NULL-or-empty-string), via .or()', () => {
    const b = compile(andTree(cond("c1", "first_name", "is_empty")));
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0]).toBe('or(or(first_name.is.null,first_name.eq.""))');
  });

  it('"is_not_empty" on TEXT is an and() of not-null and not-blank, via .or()', () => {
    const b = compile(andTree(cond("c1", "first_name", "is_not_empty")));
    expect(b.calls[0]).toBe('or(and(first_name.not.is.null,first_name.neq.""))');
  });

  it('"is_empty" on an array_column emits the bare {} literal, via .or()', () => {
    const b = compile(andTree(cond("c1", "tags", "is_empty")));
    expect(b.calls[0]).toBe("or(or(tags.is.null,tags.eq.{}))");
  });

  it('"is_not_empty" on an array_column, via .or()', () => {
    const b = compile(andTree(cond("c1", "tags", "is_not_empty")));
    expect(b.calls[0]).toBe("or(and(tags.not.is.null,tags.neq.{}))");
  });

  it("a jsonb-kind field renders a ->> accessor", () => {
    const b = compile(andTree(cond("c1", "note", "is", "hello")));
    expect(b.calls[0]).toBe('or(custom_fields->>note.eq.hello)');
  });

  it("date operators always go through the string path (never native)", () => {
    const b = compile(andTree(cond("c1", "created_at", "before", "2026-01-01T00:00:00.000Z")));
    expect(b.calls[0]).toMatch(/^or\(created_at\.lt\./);
  });
});

// ── Negation includes empty rows — the #1 correctness trap ───────────────

describe("negation includes empty rows", () => {
  const negativeCases: { op: FilterCondition["op"]; field: string; value: FilterCondition["value"] }[] = [
    { op: "is_not", field: "first_name", value: "Jane" },
    { op: "is_not", field: "age", value: 5 as unknown as string }, // number type via "is"/"is_not" scalarValue
    { op: "is_not", field: "assigned_to", value: "11111111-1111-1111-1111-111111111111" },
    { op: "is_not", field: "industry", value: "engineering" },
    { op: "not_contains", field: "first_name", value: "an" },
    { op: "is_none_of", field: "assigned_to", value: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"] },
    { op: "is_none_of", field: "tags", value: ["vip"] },
  ];

  it.each(negativeCases)("$op on $field compiles to or(<col>.is.null, <negation>)", ({ op, field, value }) => {
    const b = compile(andTree(cond("c1", field, op, value)));
    expect(b.calls).toHaveLength(1);
    const col = registry[field].source.kind === "array_column" || registry[field].source.kind === "column" ? (registry[field].source as { column: string }).column : "";
    // The rendered predicate is `or(<col>.is.null,<negation>)`, itself wrapped
    // once more by applyConditionToBuilder's own .or(predicate) call — so the
    // NULL leg appears immediately after the INNER or(, not the outer one.
    expect(b.calls[0]).toContain(`or(${col}.is.null,`);
  });

  it('"is_not" on a NULL row must be INCLUDED, not excluded — <col>.is.null is the first OR leg', () => {
    const b = compile(andTree(cond("c1", "industry", "is_not", "engineering")));
    expect(b.calls[0]).toBe("or(or(prospect_industry.is.null,prospect_industry.neq.engineering))");
  });

  it('"not_contains" NULL-inclusive form', () => {
    const b = compile(andTree(cond("c1", "first_name", "not_contains", "an")));
    expect(b.calls[0]).toBe("or(or(first_name.is.null,first_name.not.ilike.%an%))");
  });

  it('"is_none_of" on a scalar column NULL-inclusive form', () => {
    const b = compile(
      andTree(cond("c1", "assigned_to", "is_none_of", ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]))
    );
    expect(b.calls[0]).toBe(
      "or(or(assigned_to.is.null,assigned_to.not.in.(11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222)))"
    );
  });

  it('"is_none_of" on an array_column (tags) NULL-inclusive form uses .not.ov.', () => {
    const b = compile(andTree(cond("c1", "tags", "is_none_of", ["vip"])));
    expect(b.calls[0]).toBe("or(or(tags.is.null,tags.not.ov.{vip}))");
  });
});

// ── Promoted dual-read (legacy custom_fields trap) — both polarities ─────

describe("promoted field dual-read (legacy custom_fields trap)", () => {
  it("positive op ORs the real column and the legacy jsonb leg (field_of_study, text)", () => {
    const b = compile(andTree(cond("c1", "field_of_study", "is", "Computer Science")));
    expect(b.calls[0]).toBe('or(or(field_of_study.eq."Computer Science",custom_fields->>field_of_study.eq."Computer Science"))');
  });

  it("negative op ANDs the two NEGATED, NULL-inclusive legs — De Morgan (field_of_study, text)", () => {
    const b = compile(andTree(cond("c1", "field_of_study", "is_not", "Computer Science")));
    expect(b.calls[0]).toBe(
      'or(and(or(field_of_study.is.null,field_of_study.neq."Computer Science"),or(custom_fields->>field_of_study.is.null,custom_fields->>field_of_study.neq."Computer Science")))'
    );
  });

  it("a legacy-only row (no real column value) still matches a positive promoted filter", () => {
    // This test documents the CONTRACT, not live data: the compiled predicate
    // ORs both legs, so a caller running it against a row where only
    // custom_fields.field_of_study is set will still match — verified by the
    // shape of the OR above (real leg does not gate the json leg).
    const b = compile(andTree(cond("c1", "field_of_study", "is", "Nursing")));
    expect(b.calls[0]).toContain("custom_fields->>field_of_study.eq.Nursing");
  });

  it("positive op ORs both legs for a promoted ARRAY field, but the legacy jsonb leg renders as SCALAR (custom_fields->>'countries' is a text extraction, never an array — .ov. against it is invalid Postgres and 503s)", () => {
    const b = compile(andTree(cond("c1", "destinations", "is_any_of", ["Australia", "Canada"])));
    expect(b.calls[0]).toBe("or(or(destinations.ov.{Australia,Canada},custom_fields->>countries.in.(Australia,Canada)))");
  });

  it("negative op ANDs the two negated legs for a promoted ARRAY field (is_none_of) — real leg stays array (.not.ov.), legacy jsonb leg stays scalar (.not.in.)", () => {
    const b = compile(andTree(cond("c1", "destinations", "is_none_of", ["Australia"])));
    expect(b.calls[0]).toBe(
      "or(and(or(destinations.is.null,destinations.not.ov.{Australia}),or(custom_fields->>countries.is.null,custom_fields->>countries.not.in.(Australia))))"
    );
  });

  it("has_all with 2+ values on a promoted ARRAY field drops the legacy scalar jsonb leg entirely — a scalar column can never hold ALL of 2+ discrete values, and calling the generic list renderer on it would throw FilterCompileError", () => {
    const b = compile(andTree(cond("c1", "destinations", "has_all", ["Australia", "Canada"])));
    expect(b.calls[0]).toBe("or(destinations.cs.{Australia,Canada})");
  });

  it("has_all with exactly 1 value on a promoted ARRAY field falls back to a direct equality check on the legacy scalar jsonb leg", () => {
    const b = compile(andTree(cond("c1", "destinations", "has_all", ["Australia"])));
    expect(b.calls[0]).toBe("or(or(destinations.cs.{Australia},custom_fields->>countries.eq.Australia))");
  });

  it('"is_empty" ANDs the two legs — truly empty means BOTH the real column and the legacy jsonb fallback are blank (a legacy row with real data only in custom_fields must NOT be reported as empty)', () => {
    const b = compile(andTree(cond("c1", "field_of_study", "is_empty")));
    expect(b.calls[0]).toBe(
      'or(and(or(field_of_study.is.null,field_of_study.eq.""),or(custom_fields->>field_of_study.is.null,custom_fields->>field_of_study.eq."")))'
    );
  });

  it('"is_not_empty" still ORs the two legs — correct as-is: has real data in EITHER location', () => {
    const b = compile(andTree(cond("c1", "field_of_study", "is_not_empty")));
    expect(b.calls[0]).toBe(
      'or(or(and(field_of_study.not.is.null,field_of_study.neq.""),and(custom_fields->>field_of_study.not.is.null,custom_fields->>field_of_study.neq."")))'
    );
  });
});

// ── is_any_of [] must throw, never silently no-op ─────────────────────────

describe("is_any_of with an empty value array", () => {
  it("throws FilterCompileError rather than compiling to a silent no-op filter", () => {
    expect(() => compile(andTree(cond("c1", "assigned_to", "is_any_of", [])))).toThrow(FilterCompileError);
  });

  it("also throws for is_none_of [] and has_all [] hand-built trees", () => {
    expect(() => compile(andTree(cond("c1", "assigned_to", "is_none_of", [])))).toThrow(FilterCompileError);
    expect(() => compile(andTree(cond("c1", "tags", "has_all", [])))).toThrow(FilterCompileError);
  });
});

// ── is_none_of rejected on a relation (embed) field ───────────────────────

describe("is_none_of on a relation field", () => {
  it("is rejected — !inner + not.in means 'has a collaborator who isn't X', not 'has none of X'", () => {
    expect(() => compile(andTree(cond("c1", "collaborators", "is_none_of", ["11111111-1111-1111-1111-111111111111"])))).toThrow(FilterCompileError);
  });

  it("is_any_of on the same relation field IS supported", () => {
    const b = compile(andTree(cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])));
    expect(b.calls[0]).toBe('or(user_id.in.(11111111-1111-1111-1111-111111111111))');
  });
});

// ── is_empty on a relation field — the emptyColumn escape hatch (mig 210) ───
// Same underlying problem as is_none_of above (the !inner join can only prove
// a match EXISTS, never that none does), but is_empty has a cheap way out: a
// denormalized counter column on the BASE table, maintained by a DB trigger,
// checked with zero join involved. Not every relation field has one — plain
// `collaborators` (no emptyColumn) still rejects is_empty exactly like
// is_none_of; `collaborators_with_count` is the fixture that has it wired up.
describe("is_empty on a relation field — rejected without an emptyColumn, safe with one", () => {
  it("is rejected on a relation field with no emptyColumn configured — same failure class as is_none_of", () => {
    expect(() => compile(andTree(cond("c1", "collaborators", "is_empty")))).toThrow(FilterCompileError);
  });

  it("planFilter reports the same rejection up front, not just a compileFilter throw", () => {
    const result = planFilter(andTree(cond("c1", "collaborators", "is_empty")), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.collaborators?.[0]).toMatch(/is_empty is not supported/);
  });

  it("WITH emptyColumn configured: compiles straight to <emptyColumn>.eq.0 — the embedded table's own column never appears", () => {
    const b = compile(andTree(cond("c1", "collaborators_with_count", "is_empty")));
    expect(b.calls).toEqual(["or(collaborator_count.eq.0)"]);
  });

  it("WITH emptyColumn: does NOT carry referencedTable — this predicate targets the base table, not the embedded one", () => {
    const b = compile(andTree(cond("c1", "collaborators_with_count", "is_empty")));
    expect(b.orReferencedTables).toEqual([undefined]);
  });

  it("WITH emptyColumn: planFilter does NOT add the relation's embed — the caller never needs to join lead_collaborators just to check the count", () => {
    const result = planFilter(andTree(cond("c1", "collaborators_with_count", "is_empty")), registry, ctx);
    expect(result).toEqual({ ok: true, embeds: [] });
  });

  it("WITH emptyColumn: is_not_empty and is_any_of on the SAME field still use the real !inner join, unaffected by the escape hatch existing", () => {
    const notEmpty = planFilter(andTree(cond("c1", "collaborators_with_count", "is_not_empty")), registry, ctx);
    expect(notEmpty).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
    const b = compile(andTree(cond("c1", "collaborators_with_count", "is_any_of", ["11111111-1111-1111-1111-111111111111"])));
    expect(b.orPayloads()).toEqual(["user_id.in.(11111111-1111-1111-1111-111111111111)"]);
    expect(b.orReferencedTables).toEqual(["lead_collaborators"]);
  });

  it("is_empty (base-table leg) OR'd with is_any_of (embedded-table leg) on the SAME field is rejected — one .or({referencedTable}) call can't scope half its string to each table", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "collaborators_with_count", "is_empty"), cond("c2", "collaborators_with_count", "is_any_of", ["11111111-1111-1111-1111-111111111111"])],
    };
    const result = planFilter(tree, registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.collaborators_with_count?.[0]).toMatch(/cannot mix/);
  });

  it("is_empty ANDed with an unrelated field: no throw, both legs compile independently (AND never shares one .or() call, so there's nothing to mix)", () => {
    const b = compile(andTree(cond("c1", "status", "is", "new"), cond("c2", "collaborators_with_count", "is_empty")));
    expect(b.calls).toEqual(["or(or(stage_id.eq.new,and(stage_id.is.null,status.eq.new)))", "or(collaborator_count.eq.0)"]);
    expect(b.orReferencedTables).toEqual([undefined, undefined]);
  });
});

// ── Embed (relation) fields: referencedTable — production incident coverage ─
//
// PR #401's own production incident: any filter on Collaborators failed with
// a real Postgres/PostgREST error (PGRST100 "failed to parse logic tree").
// The prior version of this exact test file asserted `or(lead_collaborators.
// user_id.in.(u1))` as the CORRECT expected value — encoding the bug as a
// passing test, which is exactly why 1527 passing tests + clean build/lint
// never caught it. Confirmed against a real local Postgres/PostgREST
// instance (not just this fake builder) before writing these assertions —
// see the sweep in the PR description.
describe("embed (relation) fields pass referencedTable to .or() — never bake the table name into the filter string", () => {
  it("a lone Collaborators condition: filter string has NO table prefix, referencedTable is set", () => {
    const b = compile(andTree(cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])));
    expect(b.orPayloads()).toEqual(["user_id.in.(11111111-1111-1111-1111-111111111111)"]);
    expect(b.orReferencedTables).toEqual(["lead_collaborators"]);
  });

  it("Collaborators ANDed with a native-eligible field (e.g. tags has_all): the tags leg stays a plain native call, only the embed leg carries referencedTable", () => {
    const b = compile(andTree(cond("c1", "tags", "has_all", ["student"]), cond("c2", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])));
    expect(b.calls).toEqual(["contains(tags,[\"student\"])", "or(user_id.in.(11111111-1111-1111-1111-111111111111))"]);
    expect(b.orReferencedTables).toEqual(["lead_collaborators"]);
  });

  it("Collaborators ANDed with a non-native field (e.g. status is): both legs are separate .or() calls, only the embed one carries referencedTable", () => {
    const b = compile(andTree(cond("c1", "status", "is", "new"), cond("c2", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])));
    expect(b.orReferencedTables).toEqual([undefined, "lead_collaborators"]);
  });

  it("OR-toggle: two Collaborators conditions combine into ONE .or() call with referencedTable set once", () => {
    const b = compileFilter(
      new FakeBuilder(),
      { conjunction: "or", conditions: [cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"]), cond("c2", "collaborators", "is_any_of", ["22222222-2222-2222-2222-222222222222"])] },
      registry,
      ctx
    );
    expect(b.orPayloads()).toEqual(["or(user_id.in.(11111111-1111-1111-1111-111111111111),user_id.in.(22222222-2222-2222-2222-222222222222))"]);
    expect(b.orReferencedTables).toEqual(["lead_collaborators"]);
  });

  it("OR-toggle mixing Collaborators with an unrelated field: compileFilter throws rather than silently produce a query wrong for one side of the OR", () => {
    const tree: FilterTree = { conjunction: "or", conditions: [cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"]), cond("c2", "status", "is", "new")] };
    expect(() => compileFilter(new FakeBuilder(), tree, registry, ctx)).toThrow(FilterCompileError);
  });

  it("planFilter catches the same OR-mix case up front, as a clean per-field error — not just a compileFilter throw", () => {
    const tree: FilterTree = { conjunction: "or", conditions: [cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"]), cond("c2", "status", "is", "new")] };
    const result = planFilter(tree, registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.collaborators?.[0]).toMatch(/cannot mix/);
      expect(result.errors.status?.[0]).toMatch(/cannot mix/);
    }
  });

  it("planFilter does NOT flag a single-condition OR-toggle tree (nothing to mix with just one condition)", () => {
    const tree: FilterTree = { conjunction: "or", conditions: [cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])] };
    expect(planFilter(tree, registry, ctx)).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
  });
});

// ── Unknown / not-filterable / disallowed-operator rejection ─────────────

describe("registry and operator gating", () => {
  it("throws for a field key not present in the registry", () => {
    expect(() => compile(andTree(cond("c1", "does_not_exist", "is", "x")))).toThrow(FilterCompileError);
  });

  it("throws for a field marked filterable: false", () => {
    expect(() => compile(andTree(cond("c1", "hidden", "is", "x")))).toThrow(FilterCompileError);
  });

  it("throws when the operator isn't allowed for the field's type (has_all on a uuid field)", () => {
    expect(() => compile(andTree(cond("c1", "assigned_to", "has_all", ["11111111-1111-1111-1111-111111111111"])))).toThrow(FilterCompileError);
  });

  it("throws when the operator isn't allowed for the field's type (gt on a text field)", () => {
    expect(() => compile(andTree(cond("c1", "first_name", "gt" as FilterCondition["op"], "x")))).toThrow(FilterCompileError);
  });
});

// ── Virtual field (key != column trap) ────────────────────────────────────

describe("virtual field source", () => {
  it("delegates entirely to the field's own compile() function", () => {
    const b = compile(andTree(cond("c1", "status", "is", "new")));
    expect(b.calls[0]).toBe("or(or(stage_id.eq.new,and(stage_id.is.null,status.eq.new)))");
  });
});

// ── §0 fix — a condition that compiles to null is DROPPED, never emitted as
// a tautology. This is the carried-forward correctness fix from Phase 3: a
// tautology inside an OR group would make the whole group match every row.
describe("no-op condition dropping (§0 fix)", () => {
  it("a null-compiling condition inside AND makes zero .or() calls (not a tautology call)", () => {
    const b = compile(andTree(cond("c1", "maybe_noop", "is", "noop")));
    expect(b.calls).toEqual([]);
  });

  it("or(<dropped>, X) compiles to just X — not to something matching every row", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "maybe_noop", "is", "noop"), cond("c2", "industry", "is", "engineering")],
    };
    const b = compile(tree);
    expect(b.calls).toEqual(["or(prospect_industry.eq.engineering)"]);
  });

  it("if every leg of an OR group drops, the group contributes nothing — no .or() call at all", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "maybe_noop", "is", "noop"), cond("c2", "maybe_noop", "is", "noop")],
    };
    const b = compile(tree);
    expect(b.calls).toEqual([]);
  });
});

// ── uuid-typed column fields: malformed values are dropped, never sent to
// Postgres (the "Failed to fetch leads" 503 root cause) ────────────────────
//
// A plain uuid column throws a real Postgres error — 22P02 "invalid input
// syntax for type uuid" — for any non-uuid-shaped value. Confirmed live
// against a real Postgres/PostgREST instance: that error is exactly what
// propagates out of the leads route's catch-all as a 503 "Failed to fetch
// leads", killing the entire request over ONE bad value on one condition.
// assigned_to (this fixture) is a `column`-kind uuid field with no custom
// compile() of its own — the same shape as the real registry's "Stage"
// (list_id) and "Form" (form_config_id) fields that this guard exists for.
describe("uuid-typed column fields drop malformed values instead of reaching Postgres", () => {
  it("a non-uuid-shaped scalar 'is' value is dropped — zero .or()/.eq() calls, not an error", () => {
    const b = compile(andTree(cond("c1", "assigned_to", "is", "not-a-real-uuid")));
    expect(b.calls).toEqual([]);
  });

  it("a non-uuid-shaped scalar value ANDed with a valid condition: only the bad leg drops, the rest still applies", () => {
    const b = compile(andTree(cond("c1", "assigned_to", "is", "garbage"), cond("c2", "industry", "is", "engineering")));
    expect(b.calls).toEqual(["eq(prospect_industry,\"engineering\")"]);
  });

  it("is_any_of with a MIX of valid and invalid ids keeps only the valid ones — not an all-or-nothing drop", () => {
    const b = compile(andTree(cond("c1", "assigned_to", "is_any_of", ["11111111-1111-1111-1111-111111111111", "garbage", "also-bad"])));
    expect(b.calls).toEqual(['in(assigned_to,["11111111-1111-1111-1111-111111111111"])']);
  });

  it("is_any_of with EVERY id invalid drops the whole condition, same as the existing §0 fix pattern", () => {
    const b = compile(andTree(cond("c1", "assigned_to", "is_any_of", ["garbage", "also-bad"])));
    expect(b.calls).toEqual([]);
  });

  it("is_none_of with every id invalid drops inside an OR group without becoming a tautology", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "assigned_to", "is_none_of", ["garbage"]), cond("c2", "industry", "is", "engineering")],
    };
    const b = compile(tree);
    expect(b.calls).toEqual(["or(prospect_industry.eq.engineering)"]);
  });

  it("planFilter still reports ok:true for a malformed uuid value — it's dropped silently, not rejected with a 422 (matches the existing garbage-token precedent for assignees)", () => {
    const result = planFilter(andTree(cond("c1", "assigned_to", "is", "not-a-real-uuid")), registry, ctx);
    expect(result.ok).toBe(true);
  });

  // Collaborators (`type: "relation"`, not `"uuid"`) is deliberately covered
  // by the SAME guard, widened rather than duplicated — confirmed live that
  // a malformed value here hits the identical Postgres 22P02 crash against
  // lead_collaborators.user_id, a real uuid FK.
  it("Collaborators: a non-uuid-shaped is_any_of value is dropped — no embed added, no .or() call, not an error", () => {
    const plan = planFilter(andTree(cond("c1", "collaborators", "is_any_of", ["not-a-real-uuid"])), registry, ctx);
    expect(plan).toEqual({ ok: true, embeds: [] });
    const b = compile(andTree(cond("c1", "collaborators", "is_any_of", ["not-a-real-uuid"])));
    expect(b.calls).toEqual([]);
  });

  it("Collaborators: is_any_of with a MIX of valid and invalid ids keeps only the valid ones", () => {
    const b = compile(andTree(cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111", "garbage"])));
    expect(b.orPayloads()).toEqual(["user_id.in.(11111111-1111-1111-1111-111111111111)"]);
    expect(b.orReferencedTables).toEqual(["lead_collaborators"]);
  });

  // Regression coverage for a real bug caught while building this guard:
  // planFilter's embed-collection (checkCondition) and its OR-group mixing
  // check (checkOrGroupEmbedMix) both originally decided "does this need the
  // embed join?" from the RAW condition, before sanitization — so a
  // malformed-and-therefore-dropped Collaborators condition still counted as
  // "this OR group touches a relation," wrongly rejecting an OR group that
  // would have compiled fine (the bad leg just vanishes, leaving one clean
  // base-table condition — no real mixing occurs).
  it("an OR group with a malformed Collaborators value + a real base-table field does NOT falsely reject as 'cannot mix' — the bad leg is dropped, no relation ends up in play", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "collaborators", "is_any_of", ["not-a-real-uuid"]), cond("c2", "status", "is", "new")],
    };
    const plan = planFilter(tree, registry, ctx);
    expect(plan).toEqual({ ok: true, embeds: [] });
    const b = compile(tree);
    expect(b.orReferencedTables).toEqual([undefined]);
  });
});

// ── Search field (columns kind) + full-name-pair matching ────────────────

describe("columns-kind field (multi-column search)", () => {
  it("ORs a single-token search across every column", () => {
    const b = compile(andTree(cond("c1", "search", "contains", "jane")));
    expect(b.calls[0]).toBe("or(or(first_name.ilike.%jane%,last_name.ilike.%jane%))");
  });

  it("adds full-name token-pair legs for a two-token search, in either order", () => {
    const b = compile(andTree(cond("c1", "search", "contains", "Jane Smith")));
    const payload = b.orPayloads()[0];
    expect(payload).toContain("and(first_name.ilike.%Jane%,last_name.ilike.%Smith%)");
    expect(payload).toContain("and(first_name.ilike.%Smith%,last_name.ilike.%Jane%)");
  });

  it("does not add pair legs for a single-token search", () => {
    const b = compile(andTree(cond("c1", "search", "contains", "jane")));
    expect(b.orPayloads()[0]).not.toContain("and(");
  });

  it('"is_empty" ANDs across every column — the field is empty only if ALL columns are blank, not just one (a lead with first_name="" but a real last_name is NOT an empty name)', () => {
    const b = compile(andTree(cond("c1", "search", "is_empty")));
    expect(b.calls[0]).toBe('or(and(or(first_name.is.null,first_name.eq.""),or(last_name.is.null,last_name.eq."")))');
  });

  it('"is_not_empty" still ORs across columns — correct as-is: has data in ANY column', () => {
    const b = compile(andTree(cond("c1", "search", "is_not_empty")));
    expect(b.calls[0]).toBe(
      'or(or(and(first_name.not.is.null,first_name.neq.""),and(last_name.not.is.null,last_name.neq."")))'
    );
  });
});

// ── OR groups — group semantics ───────────────────────────────────────────

describe("group semantics", () => {
  it("root conjunction 'or' combines root conditions into ONE .or() call", () => {
    const tree: FilterTree = {
      conjunction: "or",
      conditions: [cond("c1", "industry", "is", "engineering"), cond("c2", "industry", "is", "design")],
    };
    const b = compile(tree);
    expect(b.calls).toEqual(["or(or(prospect_industry.eq.engineering,prospect_industry.eq.design))"]);
  });

  it("root 'and' + a groups[] entry with conjunction 'or' -> native root call + one separate .or() for the group", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [cond("c1", "first_name", "is", "Jane")],
      groups: [{ conjunction: "or", conditions: [cond("g1", "industry", "is", "engineering"), cond("g2", "industry", "is", "design")] }],
    };
    const b = compile(tree);
    expect(b.calls).toEqual(['eq(first_name,"Jane")', "or(or(prospect_industry.eq.engineering,prospect_industry.eq.design))"]);
  });

  it("a groups[] entry with conjunction 'and' applies its conditions natively too, ANDed with everything else", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [cond("c1", "first_name", "is", "Jane")],
      groups: [{ conjunction: "and", conditions: [cond("g1", "age", "gte", 18)] }],
    };
    const b = compile(tree);
    expect(b.calls).toEqual(['eq(first_name,"Jane")', "gte(age,18)"]);
  });

  it("multiple OR groups each produce their own separate .or() call", () => {
    const tree: FilterTree = {
      conjunction: "and",
      conditions: [],
      groups: [
        { conjunction: "or", conditions: [cond("g1", "industry", "is", "a"), cond("g2", "industry", "is", "b")] },
        { conjunction: "or", conditions: [cond("g3", "tags", "is_any_of", ["x"]), cond("g4", "tags", "is_any_of", ["y"])] },
      ],
    };
    const b = compile(tree);
    expect(b.calls).toHaveLength(2);
    expect(b.calls[0]).toContain("prospect_industry");
    expect(b.calls[1]).toContain("tags");
  });

  it("an empty root + empty groups makes no calls at all", () => {
    const b = compile({ conjunction: "and", conditions: [], groups: [{ conjunction: "or", conditions: [] }] });
    expect(b.calls).toEqual([]);
  });
});

// ── Dates: frozen ctx.now, tz-aware day boundaries, DST ───────────────────

describe("dates — tz-aware boundaries with a frozen ctx.now", () => {
  function onCtx(tz: string): CompileCtx {
    return { ...ctx, tz };
  }

  it('"on" in UTC — a plain 24h day', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "on", "2026-06-15")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-06-15T00:00:00.000Z",created_at.lt."2026-06-16T00:00:00.000Z"))');
  });

  it('"on" in Asia/Kathmandu (UTC+5:45, no DST) — boundaries shifted by the fixed offset', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "on", "2026-06-15")), registry, onCtx("Asia/Kathmandu"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-06-14T18:15:00.000Z",created_at.lt."2026-06-15T18:15:00.000Z"))');
  });

  it('"on" in America/New_York on an ordinary (non-transition) day — EDT, UTC-4', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "on", "2026-06-15")), registry, onCtx("America/New_York"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-06-15T04:00:00.000Z",created_at.lt."2026-06-16T04:00:00.000Z"))');
  });

  it('"on" in America/New_York on the SPRING-FORWARD DST transition day (2026-03-08) — a 23h wall-clock day', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "on", "2026-03-08")), registry, onCtx("America/New_York"));
    // A naive `end = start + 24h` would compute 2026-03-09T05:00:00.000Z,
    // leaking one hour of the FOLLOWING day into this filter. The correct end
    // is the next day's OWN local midnight under the new EDT offset:
    // 2026-03-09T04:00:00.000Z — a 23-hour wall-clock day.
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-03-08T05:00:00.000Z",created_at.lt."2026-03-09T04:00:00.000Z"))');
  });

  it('"on" in America/New_York on the FALL-BACK DST transition day (2026-11-01) — a 25h wall-clock day', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "on", "2026-11-01")), registry, onCtx("America/New_York"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-11-01T04:00:00.000Z",created_at.lt."2026-11-02T05:00:00.000Z"))');
  });

  it('"date_between" spans from the first date\'s start to the second date\'s end', () => {
    const b = compileFilter(
      new FakeBuilder(),
      andTree(cond("c1", "created_at", "date_between", ["2026-06-15", "2026-06-17"])),
      registry,
      onCtx("UTC")
    );
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-06-15T00:00:00.000Z",created_at.lt."2026-06-18T00:00:00.000Z"))');
  });

  it('"within_last" uses ctx.now, never Date.now() — deterministic across runs', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_last", "7d")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-01-08T12:00:00.000Z",created_at.lte."2026-01-15T12:00:00.000Z"))');
  });

  it('"within_next" uses ctx.now for both bounds', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_next", "3m")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-01-15T12:00:00.000Z",created_at.lte."2026-04-15T12:00:00.000Z"))');
  });

  it('"within_last" with a year unit', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_last", "1y")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(and(created_at.gte."2025-01-15T12:00:00.000Z",created_at.lte."2026-01-15T12:00:00.000Z"))');
  });

  it('"before" excludes the given day entirely — strictly before its local start', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "before", "2026-01-01")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(created_at.lt."2026-01-01T00:00:00.000Z")');
  });

  it('"after" excludes the given day entirely too — at/after the NEXT day\'s local start, not a bare .gt on the day\'s own midnight (which would match nearly all of that day, silently meaning "on or after")', () => {
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "after", "2026-01-01")), registry, onCtx("UTC"));
    expect(b.calls[0]).toBe('or(created_at.gte."2026-01-02T00:00:00.000Z")');
  });

  it('"before"/"after" are timezone-safe like "on" — a bare YYYY-MM-DD value (what the date-picker UI actually sends) resolves against Asia/Kathmandu\'s local day, not UTC midnight', () => {
    const before = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "before", "2026-06-15")), registry, onCtx("Asia/Kathmandu"));
    expect(before.calls[0]).toBe('or(created_at.lt."2026-06-14T18:15:00.000Z")');
    const after = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "after", "2026-06-15")), registry, onCtx("Asia/Kathmandu"));
    expect(after.calls[0]).toBe('or(created_at.gte."2026-06-15T18:15:00.000Z")');
  });

  it("within_last month-unit arithmetic clamps day-of-month instead of overflowing forward (March 31 - 1 month must land on Feb's LAST day, not roll into March)", () => {
    const mar31Ctx: CompileCtx = { ...ctx, tz: "UTC", now: new Date("2026-03-31T12:00:00.000Z") };
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_last", "1m")), registry, mar31Ctx);
    // Feb 2026 has 28 days (not a leap year) — a naive setUTCMonth(current - 1)
    // on day 31 would roll forward into March (there's no Feb 31st) instead of
    // clamping to Feb's actual last day.
    expect(b.calls[0]).toBe('or(and(created_at.gte."2026-02-28T12:00:00.000Z",created_at.lte."2026-03-31T12:00:00.000Z"))');
  });

  it("within_next year-unit arithmetic clamps a leap-day Feb 29 to Feb 28 one non-leap year later", () => {
    const leapDayCtx: CompileCtx = { ...ctx, tz: "UTC", now: new Date("2028-02-29T12:00:00.000Z") };
    const b = compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_next", "1y")), registry, leapDayCtx);
    expect(b.calls[0]).toBe('or(and(created_at.gte."2028-02-29T12:00:00.000Z",created_at.lte."2029-02-28T12:00:00.000Z"))');
  });

  it('"is_empty"/"is_not_empty" on a date field', () => {
    expect(compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "is_empty")), registry, onCtx("UTC")).calls[0]).toBe("or(created_at.is.null)");
    expect(compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "is_not_empty")), registry, onCtx("UTC")).calls[0]).toBe(
      "or(created_at.not.is.null)"
    );
  });

  it("rejects a malformed relative-date value", () => {
    expect(() =>
      compileFilter(new FakeBuilder(), andTree(cond("c1", "created_at", "within_last", "bogus")), registry, onCtx("UTC"))
    ).toThrow(FilterCompileError);
  });
});

// ── planFilter: validate-everything-up-front + embed collection ──────────

describe("planFilter", () => {
  it("returns ok:true with an empty embeds list for a tree with no embed-kind conditions", () => {
    const result = planFilter(andTree(cond("c1", "first_name", "is", "Jane")), registry, ctx);
    expect(result).toEqual({ ok: true, embeds: [] });
  });

  it("collects the embedSelect string for an embed-kind condition", () => {
    const result = planFilter(andTree(cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])), registry, ctx);
    expect(result).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
  });

  it("dedupes the same embed across multiple conditions on the same relation", () => {
    const result = planFilter(
      { conjunction: "and", conditions: [cond("c1", "collaborators", "is_any_of", ["11111111-1111-1111-1111-111111111111"])], groups: [{ conjunction: "and", conditions: [cond("c2", "collaborators", "is_any_of", ["22222222-2222-2222-2222-222222222222"])] }] },
      registry,
      ctx
    );
    expect(result).toEqual({ ok: true, embeds: ["lead_collaborators!inner(user_id)"] });
  });

  it("reports an unknown field as an error keyed by the condition's field, not a throw", () => {
    const result = planFilter(andTree(cond("c1", "nope", "is", "x")), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.nope?.[0]).toMatch(/unknown filter field/);
  });

  it("reports a not-filterable field as an error, not a throw", () => {
    const result = planFilter(andTree(cond("c1", "hidden", "is", "x")), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.hidden?.[0]).toMatch(/not filterable/);
  });

  it("reports a disallowed operator as an error", () => {
    const result = planFilter(andTree(cond("c1", "age", "contains", "5")), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.age?.[0]).toMatch(/operator contains is not allowed/);
  });

  it("reports is_none_of on a relation field as an error, matching compileFilter's rejection", () => {
    const result = planFilter(andTree(cond("c1", "collaborators", "is_none_of", ["11111111-1111-1111-1111-111111111111"])), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.collaborators?.[0]).toMatch(/is_none_of is not allowed|is_none_of is not supported/);
  });

  it("reports an empty list value for is_any_of as an error rather than a silent no-op", () => {
    const result = planFilter(andTree(cond("c1", "tags", "is_any_of", [])), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.tags?.[0]).toMatch(/requires at least one value/);
  });

  it("collects EVERY error across multiple bad conditions in one pass, not just the first", () => {
    const result = planFilter(andTree(cond("c1", "nope", "is", "x"), cond("c2", "hidden", "is", "y")), registry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["hidden", "nope"]);
    }
  });

  it("denies a field whose visibleTo predicate rejects the caller's permissions", () => {
    const gatedRegistry: FieldRegistry = {
      ...registry,
      gated: {
        key: "gated",
        label: "Gated",
        type: "text",
        source: { kind: "column", column: "secret2" },
        group: "Basic",
        filterable: true,
        visibleTo: () => false,
      },
    };
    const result = planFilter(andTree(cond("c1", "gated", "is", "x")), gatedRegistry, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.gated?.[0]).toMatch(/not accessible/);
  });

  // Gap 4 (production-readiness audit, same session as migration 207/208):
  // field.industries existed on FieldDef from Phase 1 but nothing ever read it —
  // every tenant's registry offered every field regardless of industry_id.
  describe("field.industries — industry-scoped fields", () => {
    const eduOnlyRegistry: FieldRegistry = {
      ...registry,
      destinations: {
        key: "destinations",
        label: "Destinations",
        type: "text",
        source: { kind: "column", column: "destinations" },
        group: "Education",
        filterable: true,
        industries: ["education_consultancy"],
      },
    };

    it("denies the condition when ctx.industryId does not match the field's allow-list", () => {
      const result = planFilter(
        andTree(cond("c1", "destinations", "is", "UK")),
        eduOnlyRegistry,
        { ...ctx, industryId: "it_agency" }
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.destinations?.[0]).toMatch(/not accessible/);
    });

    it("denies the condition when ctx.industryId is null — an explicit allow-list is never satisfied by 'no industry'", () => {
      const result = planFilter(andTree(cond("c1", "destinations", "is", "UK")), eduOnlyRegistry, { ...ctx, industryId: null });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.destinations?.[0]).toMatch(/not accessible/);
    });

    it("allows the condition when ctx.industryId matches the field's allow-list", () => {
      const result = planFilter(
        andTree(cond("c1", "destinations", "is", "UK")),
        eduOnlyRegistry,
        { ...ctx, industryId: "education_consultancy" }
      );
      expect(result.ok).toBe(true);
    });

    it("never restricts a field with no industries key (undefined = all industries)", () => {
      // `registry`'s ordinary fields (e.g. first_name) carry no `industries` — must
      // stay reachable from every ctx.industryId, including null.
      const result = planFilter(andTree(cond("c1", "first_name", "is", "x")), registry, { ...ctx, industryId: null });
      expect(result.ok).toBe(true);
    });
  });
});

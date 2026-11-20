import { describe, expect, it } from "vitest";
import type { CompileCtx, FilterCondition, FilterTree } from "@/lib/filters/types";
import {
  buildBranches,
  mergeMine,
  planApplicationsQuery,
  runApplicationsQuery,
  sortApplications,
  APPLICATION_SORTS,
  SORT_BY_FIELD,
  sortFieldOf,
  type ApplicationsScope,
} from "./applications-query";
import { parseSort, SORT_LABELS } from "./applications-url";

const ctx: CompileCtx = { tz: "UTC", now: new Date("2026-01-15T12:00:00.000Z"), industryId: "education_consultancy", permissions: {} };
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const cond = (field: string, op: FilterCondition["op"], value?: FilterCondition["value"]): FilterCondition =>
  ({ id: `${field}-${op}`, field, op, value }) as FilterCondition;
const and = (...conditions: FilterCondition[]): FilterTree => ({ conjunction: "and", conditions });

// ── a tiny in-memory PostgREST: evaluates the recorded calls against fixture rows ─────────────
interface Row {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  university_name: string;
  program_name: string | null;
  stage_id: string;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
  application_deadline: string | null;
  leads: { assigned_to: string | null; first_name: string; last_name: string };
}
type Pred = (r: Row) => boolean;

function getCol(r: Row, col: string): unknown {
  if (col.startsWith("leads.")) return (r.leads as Record<string, unknown>)[col.slice(6)];
  return (r as unknown as Record<string, unknown>)[col];
}
const parseList = (s: string) => s.replace(/^\(|\)$/g, "").split(",");
const likeRe = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");

const splitTop = (f: string) => f.split(/,(?![^(]*\))/);
function leaf(expr: string, table: string | null): Pred {
  const group = expr.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const legs = splitTop(group[2]).map((e) => leaf(e, table));
    return group[1] === "and" ? (r) => legs.every((p) => p(r)) : (r) => legs.some((p) => p(r));
  }
  const [col, op, ...rest] = expr.split(".");
  const val = rest.join(".");
  const colName = table ? `${table}.${col}` : col;
  return (r) => {
    const v = getCol(r, colName);
    if (op === "is") return v === null;
    if (op === "ilike") return typeof v === "string" && likeRe(val).test(v);
    if (op === "not") {
      const [op2, ...r2] = rest;
      const v2 = r2.join(".");
      if (op2 === "is") return v !== null;
      if (op2 === "in") return !parseList(v2).includes(String(v));
      if (op2 === "ilike") return !(typeof v === "string" && likeRe(v2).test(v));
    }
    throw new Error(`fake: unsupported ${expr}`);
  };
}

class FakeQuery implements PromiseLike<{ data: unknown; count: number | null; error: null }> {
  preds: Pred[] = [];
  log: string[] = [];
  private window: [number, number] | null = null;
  constructor(private rows: Row[], private head: boolean) {}
  order(c: string) { this.log.push(`order(${c})`); return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  private add(label: string, p: Pred): this { this.log.push(label); this.preds.push(p); return this; }
  select() { return this; }
  eq(c: string, v: unknown) { return this.add(`eq(${c})`, (r) => c === "tenant_id" || getCol(r, c) === v); }
  is(c: string, v: null | boolean) { return this.add(`is(${c})`, (r) => (c === "deleted_at" || c === "leads.deleted_at" ? true : getCol(r, c) === v)); }
  in(c: string, v: readonly unknown[]) { return this.add(`in(${c})`, (r) => v.includes(getCol(r, c))); }
  lt(c: string, v: unknown) { return this.add(`lt(${c})`, (r) => String(getCol(r, c)) < String(v)); }
  ilike(c: string, v: string) { return this.add(`ilike(${c})`, (r) => { const x = getCol(r, c); return typeof x === "string" && likeRe(v).test(x); }); }
  not(c: string, op: string, v: unknown) {
    return this.add(`not(${c},${op})`, (r) => {
      const x = getCol(r, c);
      if (op === "is") return x !== null;
      if (op === "in") return !parseList(String(v)).includes(String(x));
      if (op === "ilike") return !(typeof x === "string" && likeRe(String(v)).test(x));
      throw new Error("fake not");
    });
  }
  or(f: string, o?: { referencedTable?: string }) {
    const legs = splitTop(f).map((e) => leaf(e, o?.referencedTable ?? null));
    return this.add(`or(${f})`, (r) => legs.some((p) => p(r)));
  }
  then<T1, T2>(ok?: (v: { data: unknown; count: number | null; error: null }) => T1 | PromiseLike<T1>, bad?: (e: unknown) => T2 | PromiseLike<T2>) {
    let hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.window) hit = [...hit].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(this.window[0], this.window[1] + 1);
    return Promise.resolve({ data: this.head ? null : hit, count: this.head ? hit.length : null, error: null }).then(ok, bad);
  }
}
function fakeSupabase(rows: Row[]) {
  const queries: FakeQuery[] = [];
  return {
    queries,
    client: {
      from() {
        return {
          select(_s: string, opts?: { head?: boolean }) {
            const q = new FakeQuery(rows, !!opts?.head);
            queries.push(q);
            return q;
          },
        };
      },
    },
  };
}

const iso = (d: string) => `${d}T00:00:00.000Z`;
function row(id: string, o: Partial<Row> & { lead?: Partial<Row["leads"]> } = {}): Row {
  const { lead, ...rest } = o;
  return {
    id, lead_id: `l-${id}`, assigned_to: null, university_name: "Uni", program_name: "Prog", stage_id: "s1",
    stage_changed_at: iso("2026-01-01"), created_at: iso("2026-01-01"), updated_at: iso("2026-01-01"), application_deadline: null,
    leads: { assigned_to: null, first_name: "Sam", last_name: "Lee", ...lead },
    ...rest,
  };
}

const FIXTURE: Row[] = [
  row("1", { assigned_to: A }),                              // app counsellor A
  row("2", { assigned_to: null, lead: { assigned_to: A } }), // lead counsellor A (counts as A)
  row("3", { assigned_to: B, lead: { assigned_to: A } }),    // app wins: B, NOT A
  row("4", { assigned_to: null, lead: { assigned_to: null } }), // unassigned
  row("5", { assigned_to: null, lead: { assigned_to: C } }),
  row("6", { university_name: "Harvard", program_name: null, lead: { first_name: "Ann", last_name: "Harvard-Smith" } }),
  row("7", { university_name: "Yale", program_name: "Law", lead: { first_name: "Harvey", last_name: "Specter" } }),
  row("8", { university_name: "MIT", program_name: "Harvard Studies" }),
];
const scope: ApplicationsScope = { leadIds: null, teamMemberIds: null };

async function ids(tree: FilterTree, tab = {}, sc: ApplicationsScope = scope, q?: string) {
  const { client, queries } = fakeSupabase(FIXTURE);
  const res = await runApplicationsQuery({ supabase: client as never, tenantId: "t", scope: sc, tree, tab, q, ctx, mode: "rows" });
  if (!res.ok || res.mode !== "rows") throw new Error(res.ok ? "mode" : res.error);
  return { ids: res.rows.map((r) => r.id).sort(), queries, branches: res.branches };
}
async function count(tree: FilterTree, tab = {}) {
  const { client } = fakeSupabase(FIXTURE);
  const res = await runApplicationsQuery({ supabase: client as never, tenantId: "t", scope, tree, tab, ctx, mode: "count" });
  if (!res.ok || res.mode !== "count") throw new Error("count");
  return res.count;
}

describe("planApplicationsQuery", () => {
  it("splits cross-table fields out of the tree compileFilter sees", () => {
    const r = planApplicationsQuery(and(cond("counsellor", "is", A), cond("intake", "is", "Fall"), cond("search", "contains", "har")));
    expect(r.ok && r.plan.restTree.conditions.map((c) => c.field)).toEqual(["intake"]);
    expect(r.ok && r.plan.counsellor).toEqual({ mode: "in", ids: [A] });
    expect(r.ok && r.plan.search).toBe("har");
  });
  it("rejects counsellor / student / search inside an OR group with a friendly message", () => {
    const rootOr: FilterTree = { conjunction: "or", conditions: [cond("counsellor", "is", A), cond("intake", "is", "x")] };
    expect(planApplicationsQuery(rootOr)).toEqual({ ok: false, error: "Counsellor can't be combined with OR yet" });
    const groupOr: FilterTree = { conjunction: "and", conditions: [], groups: [{ conjunction: "or", conditions: [cond("student", "contains", "x"), cond("intake", "is", "y")] }] };
    expect(planApplicationsQuery(groupOr)).toEqual({ ok: false, error: "Student can't be combined with OR yet" });
  });
  it("allows cross-table fields inside an AND group", () => {
    const t: FilterTree = { conjunction: "and", conditions: [], groups: [{ conjunction: "and", conditions: [cond("counsellor", "is", A)] }] };
    expect(planApplicationsQuery(t).ok).toBe(true);
  });
  it("drops a counsellor condition with no valid uuid (no filter, never a 22P02)", () => {
    const r = planApplicationsQuery(and(cond("counsellor", "is", "not-a-uuid")));
    expect(r.ok && r.plan.counsellor).toBeNull();
  });
  it("a Counsellor chip plus the My tab merges instead of doubling the branches", () => {
    expect(mergeMine({ mode: "in", ids: [A, B] }, A)).toEqual({ mode: "in", ids: [A] });
    expect(mergeMine({ mode: "in", ids: [B] }, A)).toEqual({ mode: "nothing" });
    expect(mergeMine({ mode: "not_in", ids: [B] }, A)).toEqual({ mode: "in", ids: [A] });
    expect(mergeMine({ mode: "not_in", ids: [A] }, A)).toEqual({ mode: "nothing" });
    expect(mergeMine({ mode: "null" }, A)).toEqual({ mode: "nothing" });
    expect(mergeMine({ mode: "not_null" }, A)).toEqual({ mode: "in", ids: [A] });
    expect(mergeMine(null, A)).toEqual({ mode: "in", ids: [A] });
  });
});

describe("search box (q) is a top-level AND input, never folded into the tree (B1)", () => {
  // compile.ts GROUP SEMANTICS: (root conditions joined by the root conjunction) AND group 1 AND ...
  // Here: (university ~ yale OR program ~ harvard) AND (university ~ yale OR university ~ mit).
  const orWithGroup: FilterTree = {
    conjunction: "or",
    conditions: [cond("university", "contains", "yale"), cond("program", "contains", "harvard")],
    groups: [{ conjunction: "or", conditions: [cond("university", "contains", "yale"), cond("university", "contains", "mit")] }],
  };
  it("keeps an OR-root tree (and its groups) exactly as given; q goes to plan.search", () => {
    const r = planApplicationsQuery(orWithGroup, {}, "  har ");
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.restTree).toEqual(orWithGroup);
    expect(r.plan.search).toBe("har");
  });
  it("OR root with groups + q = the tree's own result, ANDed with the search", async () => {
    // 7: Yale / Law / student Harvey; 8: MIT / 'Harvard Studies'; 6 (Harvard univ, no program) fails both clauses.
    expect((await ids(orWithGroup)).ids).toEqual(["7", "8"]);
    expect((await ids(orWithGroup, {}, scope, "har")).ids).toEqual(["7", "8"]); // name Harvey / program Harvard
    expect((await ids(orWithGroup, {}, scope, "harvey")).ids).toEqual(["7"]);
    expect((await ids(orWithGroup, {}, scope, "studies")).ids).toEqual(["8"]);
    expect((await ids(orWithGroup, {}, scope, "zzz")).ids).toEqual([]);
  });
  it("q plus a search condition already in the tree is one search too many", () => {
    expect(planApplicationsQuery(and(cond("search", "contains", "x")), {}, "y")).toEqual({ ok: false, error: "Only one search can be applied at a time" });
  });
  it("blank q is no search", () => {
    const r = planApplicationsQuery(and(), {}, "   ");
    expect(r.ok && r.plan.search).toBeNull();
  });
});

describe("branches", () => {
  it("counsellor = X is two branches; counsellor + search is four; neither is one", () => {
    const p = (t: FilterTree) => { const r = planApplicationsQuery(t); if (!r.ok) throw new Error(r.error); return r.plan; };
    expect(buildBranches(p(and(cond("counsellor", "is", A)))).map((b) => b.label)).toEqual(["counsellor:app", "counsellor:lead"]);
    expect(buildBranches(p(and(cond("search", "contains", "x"))))).toHaveLength(2);
    expect(buildBranches(p(and(cond("counsellor", "is", A), cond("search", "contains", "x"))))).toHaveLength(4);
    expect(buildBranches(p(and(cond("intake", "is", "x"))))).toHaveLength(1);
  });
  it("a tree with counsellor and search runs 4 queries", async () => {
    const r = await ids(and(cond("counsellor", "is", A), cond("search", "contains", "har")));
    expect(r.queries).toHaveLength(4);
    expect(r.branches).toBe(4);
  });
});

describe("runApplicationsQuery on a fixture set", () => {
  it("counsellor = A is the EFFECTIVE counsellor: app.assigned_to, else the lead's", async () => {
    expect((await ids(and(cond("counsellor", "is", A)))).ids).toEqual(["1", "2"]); // not 3 (app says B)
    expect((await ids(and(cond("counsellor", "is", B)))).ids).toEqual(["3"]);
  });
  it("'My applications' for a user who is ONLY the lead's counsellor", async () => {
    expect((await ids(and(), { mineUserId: C })).ids).toEqual(["5"]);
  });
  it("is not A includes unassigned and other counsellors (NULL-inclusive)", async () => {
    expect((await ids(and(cond("counsellor", "is_not", A)))).ids).toEqual(["3", "4", "5", "6", "7", "8"]);
  });
  it("is empty / is not empty partition the set", async () => {
    const e = (await ids(and(cond("counsellor", "is_empty")))).ids;
    const n = (await ids(and(cond("counsellor", "is_not_empty")))).ids;
    expect(e).toEqual(["4", "6", "7", "8"]);
    expect([...e, ...n].sort()).toEqual(FIXTURE.map((r) => r.id).sort());
  });
  it("branches are disjoint: no application matches both branches of any case", async () => {
    const cases: FilterTree[] = [
      and(cond("counsellor", "is", A)), and(cond("counsellor", "is_not", A)), and(cond("counsellor", "is_not_empty")),
      and(cond("search", "contains", "harvard")), and(cond("counsellor", "is", A), cond("search", "contains", "sam")),
    ];
    for (const t of cases) {
      const r = planApplicationsQuery(t);
      if (!r.ok) throw new Error(r.error);
      const per = buildBranches(r.plan).map((br) => {
        const q = new FakeQuery(FIXTURE, false);
        br.apply(q as never);
        return new Set(FIXTURE.filter((x) => q.preds.every((p) => p(x))).map((x) => x.id));
      });
      const all = per.flatMap((s) => [...s]);
      expect(new Set(all).size, JSON.stringify(t)).toBe(all.length);
    }
  });
  it("count = the sum of the branch counts = the merged row count", async () => {
    for (const t of [and(cond("counsellor", "is", A)), and(cond("search", "contains", "harvard")), and(cond("counsellor", "is_not", A), cond("search", "contains", "sam"))]) {
      expect(await count(t)).toBe((await ids(t)).ids.length);
    }
  });
  it("search matches university, program (incl. a NULL program) or the student's name words", async () => {
    // 6: university Harvard + lead name; 7: lead 'Harvey' only for 'harve'; 8: program 'Harvard Studies'
    expect((await ids(and(cond("search", "contains", "harvard")))).ids).toEqual(["6", "8"]);
    expect((await ids(and(cond("search", "contains", "harve")))).ids).toEqual(["7"]);
    expect((await ids(and(cond("search", "contains", "ann smith")))).ids).toEqual(["6"]);
  });
  it("student chip = every word matches first or last name", async () => {
    expect((await ids(and(cond("student", "contains", "harvey spec")))).ids).toEqual(["7"]);
  });
  it("stuck tab: older than the cutoff and not in a finished stage", async () => {
    const rows = [row("old-open", { stage_changed_at: iso("2025-11-01") }), row("old-done", { stage_changed_at: iso("2025-11-01"), stage_id: "done" }), row("fresh", { stage_changed_at: iso("2026-01-10") })];
    const { client } = fakeSupabase(rows);
    const res = await runApplicationsQuery({
      supabase: client as never, tenantId: "t", scope, tree: and(), ctx, mode: "rows",
      tab: { stuck: { cutoffIso: iso("2025-12-16"), finishedStageIds: ["done"] } },
    });
    expect(res.ok && res.mode === "rows" && res.rows.map((r) => r.id)).toEqual(["old-open"]);
  });
  it("own scope with no visible leads is an empty result, no query", async () => {
    const r = await ids(and(), {}, { leadIds: [], teamMemberIds: null });
    expect(r.ids).toEqual([]);
    expect(r.queries).toHaveLength(0);
  });
  it("own scope past 250 lead ids chunks the queries and still merges", async () => {
    const many = Array.from({ length: 600 }, (_, i) => `l-${i}`);
    const r = await ids(and(), {}, { leadIds: many, teamMemberIds: null });
    expect(r.queries).toHaveLength(3);
  });
  it("an OR-group rejection comes back as ok:false, never a throw", async () => {
    const { client } = fakeSupabase(FIXTURE);
    const t: FilterTree = { conjunction: "or", conditions: [cond("counsellor", "is", A), cond("intake", "is", "x")] };
    const res = await runApplicationsQuery({ supabase: client as never, tenantId: "t", scope, tree: t, ctx, mode: "rows" });
    expect(res).toEqual({ ok: false, error: "Counsellor can't be combined with OR yet" });
  });
});

describe("sortApplications", () => {
  const r = (id: string, o: Record<string, string | null>) => ({ id, created_at: "2026-01-01", updated_at: "2026-01-01", stage_changed_at: "2026-01-01", university_name: "B", application_deadline: null, ...o });
  it("time in stage: longest in stage first", () => {
    expect(sortApplications([r("new", { stage_changed_at: "2026-01-10" }), r("old", { stage_changed_at: "2025-12-01" })], "stage").map((x) => x.id)).toEqual(["old", "new"]);
  });
  it("deadline soonest first, no deadline last; university A-Z; newest; updated", () => {
    expect(sortApplications([r("none", {}), r("late", { application_deadline: "2026-03-01" }), r("soon", { application_deadline: "2026-02-01" })], "deadline").map((x) => x.id)).toEqual(["soon", "late", "none"]);
    expect(sortApplications([r("b", { university_name: "Yale" }), r("a", { university_name: "harvard" })], "university").map((x) => x.id)).toEqual(["a", "b"]);
    expect(sortApplications([r("o", { created_at: "2025-01-01" }), r("n", { created_at: "2026-01-01" })], "newest").map((x) => x.id)).toEqual(["n", "o"]);
    expect(sortApplications([r("o", { updated_at: "2025-01-01" }), r("n", { updated_at: "2026-01-01" })], "updated").map((x) => x.id)).toEqual(["n", "o"]);
  });
  it("Phase 4 directions: each field sorts both ways, with an id tie-break and no-deadline last", () => {
    const ids = (sort: Parameters<typeof sortApplications>[1], rows: ReturnType<typeof r>[]) => sortApplications(rows, sort).map((x) => x.id);
    expect(ids("stage_asc", [r("old", { stage_changed_at: "2025-12-01" }), r("new", { stage_changed_at: "2026-01-10" })])).toEqual(["new", "old"]);
    expect(ids("created_asc", [r("n", { created_at: "2026-01-01" }), r("o", { created_at: "2025-01-01" })])).toEqual(["o", "n"]);
    expect(ids("updated_asc", [r("n", { updated_at: "2026-01-01" }), r("o", { updated_at: "2025-01-01" })])).toEqual(["o", "n"]);
    expect(ids("university_desc", [r("a", { university_name: "harvard" }), r("b", { university_name: "Yale" })])).toEqual(["b", "a"]);
    expect(ids("deadline_desc", [r("none", {}), r("soon", { application_deadline: "2026-02-01" }), r("late", { application_deadline: "2026-03-01" })])).toEqual(["late", "soon", "none"]);
    // ties fall back to id in every direction
    expect(ids("university_desc", [r("z", {}), r("a", {})])).toEqual(["a", "z"]);
  });
  it("every sort has a label, parses from the URL, and maps back to its field + direction", () => {
    for (const s of APPLICATION_SORTS) {
      expect(SORT_LABELS[s]).toBeTruthy();
      expect(parseSort(s)).toBe(s);
      const { field, dir } = sortFieldOf(s);
      expect(SORT_BY_FIELD[field][dir]).toBe(s);
    }
    // old URLs keep their meaning
    expect(sortFieldOf("stage")).toEqual({ field: "stage", dir: "desc" });
    expect(sortFieldOf("university")).toEqual({ field: "university", dir: "asc" });
    expect(parseSort("bogus")).toBe("stage");
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import { compileFilter, planFilter, type QueryBuilder } from "@/lib/filters/compile";
import { pgLike } from "@/lib/filters/pgrst";
import { applicationFields, CROSS_TABLE_KEYS } from "@/lib/filters/registry/applications";
import type { CompileCtx, FilterCondition, FilterGroup, FilterLeafGroup, FilterTree } from "@/lib/filters/types";
import type { Application } from "@/types/database";
import { chunk, PAGE_SIZE } from "./board-counts";

// The ONE place that turns an applications filter tree into PostgREST queries (EDGEX-141 Phase 2).
//
// Why branches: `counsellor` (applications.assigned_to, else leads.assigned_to) and `search`
// (university/program OR student name) each need an OR across the base table and the embedded lead,
// which PostgREST cannot express. Each is therefore split into DISJOINT branch queries that are
// merged by id; because the branches never overlap, exact head counts simply add up.
//
// Phase 3: rows mode pages through EVERY matching row (.order("id").range()), never stopping at
// PostgREST's 1000-row cap; a safety ceiling flags `truncated` instead of returning a wrong count.
// A DB view (EDGEX-165) replaces this in-memory index later. Keep every caller going through
// runApplicationsQuery.

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const APPLICATION_SORTS = ["stage", "newest", "updated", "university", "deadline"] as const;
export type ApplicationSort = (typeof APPLICATION_SORTS)[number];
export const DEFAULT_APPLICATION_SORT: ApplicationSort = "stage";

export const APPLICATION_SELECT =
  "*, leads!applications_lead_id_fkey!inner(id,first_name,last_name,email,assigned_to)";
/**
 * The board INDEX row (Phase 3): enough to place, count, facet and sort every application without
 * loading its card. Used for both the unfiltered read (tab counts, "of T", stage + pipeline totals,
 * filter options + counts; board-data.ts) and the filtered read (column counts, "N", card order).
 */
export const APPLICATION_LIGHT_SELECT =
  "id, lead_id, stage_id, pipeline_id, stage_changed_at, created_at, updated_at, university_name, application_deadline, assigned_to, intake_term, countries, offer_type, leads!applications_lead_id_fkey!inner(assigned_to)";

/** Rows mode stops here (log + `truncated`) rather than reading an unbounded tenant into memory. */
export const INDEX_ROW_CEILING = 50_000;

export interface ApplicationsScope {
  /** null = no lead-id restriction; [] = empty result (own-scope with no visible leads). */
  leadIds: string[] | null;
  /** Branch scope: leads assigned to one of these users. */
  teamMemberIds: string[] | null;
}

// ── Plan (pure) ─────────────────────────────────────────────────────────────────────

export type CounsellorSpec =
  | { mode: "in"; ids: string[] }
  | { mode: "not_in"; ids: string[] }
  | { mode: "null" }
  | { mode: "not_null" }
  | { mode: "nothing" };

export interface ApplicationsPlan {
  /** Everything compileFilter can handle (the cross-table fields removed). */
  restTree: FilterTree;
  counsellor: CounsellorSpec | null;
  /** Student-name words: every word must match the lead's first or last name. */
  studentWords: string[][];
  /** Whole-string search over university / program, OR the student's name words. */
  search: string | null;
  /** Stuck tab: stage_changed_at older than cutoff and not in a finished stage. */
  stuck: { cutoffIso: string; finishedStageIds: string[] } | null;
}

export type PlanResult = { ok: true; plan: ApplicationsPlan } | { ok: false; error: string };

export interface ApplicationsTab {
  /** "mine": counsellor is this user (merged with any Counsellor chip). */
  mineUserId?: string | null;
  stuck?: { cutoffIso: string; finishedStageIds: string[] } | null;
}

const CROSS = new Set<string>(CROSS_TABLE_KEYS);
const CROSS_LABEL: Record<string, string> = { counsellor: "Counsellor", student: "Student", search: "Search" };

function listOf(c: FilterCondition): string[] {
  const v = c.value;
  if (Array.isArray(v)) return v.map(String);
  return v === undefined ? [] : [String(v)];
}

function words(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function counsellorSpecOf(c: FilterCondition): CounsellorSpec | null {
  if (c.op === "is_empty") return { mode: "null" };
  if (c.op === "is_not_empty") return { mode: "not_null" };
  const ids = listOf(c).filter((v) => UUID_SHAPE.test(v));
  // Same precedent as the leads registry: no valid value -> the condition drops (no filter).
  if (ids.length === 0) return null;
  return c.op === "is_not" || c.op === "is_none_of" ? { mode: "not_in", ids } : { mode: "in", ids };
}

/** Counsellor chip AND "My applications" (counsellor is me): set algebra on one spec. */
export function mergeMine(spec: CounsellorSpec | null, me: string): CounsellorSpec {
  if (!spec) return { mode: "in", ids: [me] };
  switch (spec.mode) {
    case "in":
      return spec.ids.includes(me) ? { mode: "in", ids: [me] } : { mode: "nothing" };
    case "not_in":
      return spec.ids.includes(me) ? { mode: "nothing" } : { mode: "in", ids: [me] };
    case "null":
      return { mode: "nothing" };
    case "not_null":
      return { mode: "in", ids: [me] };
    case "nothing":
      return spec;
  }
}

/**
 * Splits a tree into the part compileFilter handles and the three cross-table fields.
 * Cross-table fields are only legal in the top-level AND (root conditions of an AND tree, or
 * inside an AND group); anywhere inside an OR the plan is rejected with a friendly message.
 *
 * `q` (the search box) is its own top-level AND input, never folded into the tree: folding it
 * into an OR-root tree would have to rewrite the root as AND and so change what its groups mean.
 */
export function planApplicationsQuery(tree: FilterTree, tab: ApplicationsTab = {}, q = ""): PlanResult {
  const rootIsAnd = tree.conjunction === "and";
  const crossConds: FilterCondition[] = [];
  const rest = (conds: FilterCondition[], allowed: boolean): FilterCondition[] | string => {
    const out: FilterCondition[] = [];
    for (const c of conds) {
      if (!CROSS.has(c.field)) {
        out.push(c);
      } else if (allowed) {
        crossConds.push(c);
      } else {
        return `${CROSS_LABEL[c.field] ?? c.field} can't be combined with OR yet`;
      }
    }
    return out;
  };

  const rootRest = rest(tree.conditions, rootIsAnd);
  if (typeof rootRest === "string") return { ok: false, error: rootRest };
  const groups: FilterLeafGroup[] = [];
  for (const g of tree.groups ?? []) {
    const r = rest(g.conditions, g.conjunction === "and");
    if (typeof r === "string") return { ok: false, error: r };
    groups.push({ ...g, conditions: r });
  }
  const restTree: FilterGroup = { conjunction: tree.conjunction, conditions: rootRest, groups };

  const counsellors = crossConds.filter((c) => c.field === "counsellor");
  if (counsellors.length > 1) return { ok: false, error: "Only one Counsellor filter can be applied at a time" };
  const searches = crossConds.filter((c) => c.field === "search");
  if (searches.length > 1) return { ok: false, error: "Only one search can be applied at a time" };

  let counsellor = counsellors[0] ? counsellorSpecOf(counsellors[0]) : null;
  if (tab.mineUserId) counsellor = mergeMine(counsellor, tab.mineUserId);

  const studentWords = crossConds
    .filter((c) => c.field === "student")
    .map((c) => words(String(c.value ?? "")))
    .filter((w) => w.length > 0);

  const boxText = q.trim();
  if (boxText && searches.length > 0) return { ok: false, error: "Only one search can be applied at a time" };
  const text = boxText || (searches[0] ? String(searches[0].value ?? "").trim() : "");
  return {
    ok: true,
    plan: { restTree, counsellor, studentWords, search: text || null, stuck: tab.stuck ?? null },
  };
}

// ── Branches (pure, tested with a fake builder) ────────────────────────────────────

export type ApplicationsBuilder = QueryBuilder & {
  or(filters: string, opts?: { referencedTable?: string }): ApplicationsBuilder;
};
type Apply = (b: ApplicationsBuilder) => ApplicationsBuilder;
export interface Branch {
  label: string;
  apply: Apply;
}

const inList = (ids: string[]) => `(${ids.join(",")})`;

function counsellorBranches(spec: CounsellorSpec): Branch[] {
  switch (spec.mode) {
    case "nothing":
      return [];
    case "in":
      return [
        { label: "counsellor:app", apply: (b) => b.in("assigned_to", spec.ids) },
        { label: "counsellor:lead", apply: (b) => b.is("assigned_to", null).in("leads.assigned_to", spec.ids) },
      ];
    case "not_in":
      return [
        { label: "counsellor:app", apply: (b) => b.not("assigned_to", "is", null).not("assigned_to", "in", inList(spec.ids)) },
        {
          label: "counsellor:lead",
          apply: (b) =>
            b
              .is("assigned_to", null)
              .or(`assigned_to.is.null,assigned_to.not.in.${inList(spec.ids)}`, { referencedTable: "leads" }),
        },
      ];
    case "null":
      return [{ label: "counsellor:none", apply: (b) => b.is("assigned_to", null).is("leads.assigned_to", null) }];
    case "not_null":
      return [
        { label: "counsellor:app", apply: (b) => b.not("assigned_to", "is", null) },
        { label: "counsellor:lead", apply: (b) => b.is("assigned_to", null).not("leads.assigned_to", "is", null) },
      ];
  }
}

function nameWordFilters(b: ApplicationsBuilder, ws: string[]): ApplicationsBuilder {
  let out = b;
  for (const w of ws) {
    const p = pgLike(w, "contains");
    out = out.or(`first_name.ilike.${p},last_name.ilike.${p}`, { referencedTable: "leads" });
  }
  return out;
}

function searchBranches(q: string): Branch[] {
  const p = pgLike(q, "contains");
  return [
    { label: "search:app", apply: (b) => b.or(`university_name.ilike.${p},program_name.ilike.${p}`) },
    {
      label: "search:lead",
      apply: (b) =>
        nameWordFilters(b.not("university_name", "ilike", p).or(`program_name.is.null,program_name.not.ilike.${p}`), words(q)),
    },
  ];
}

/** The disjoint branches the plan needs: counsellor (<=2) x search (<=2) = at most 4. */
export function buildBranches(plan: ApplicationsPlan): Branch[] {
  const c: Branch[][] = plan.counsellor ? [counsellorBranches(plan.counsellor)] : [];
  const s: Branch[][] = plan.search ? [searchBranches(plan.search)] : [];
  const axes = [...c, ...s];
  if (axes.length === 0) return [{ label: "all", apply: (b) => b }];
  let combos: Branch[] = [{ label: "", apply: (b) => b }];
  for (const axis of axes) {
    const next: Branch[] = [];
    for (const a of combos) {
      for (const x of axis) {
        next.push({ label: a.label ? `${a.label}+${x.label}` : x.label, apply: (b) => x.apply(a.apply(b)) });
      }
    }
    combos = next;
  }
  return combos;
}

// ── Sorting (pure) ──────────────────────────────────────────────────────────────

type SortRow = Pick<Application, "created_at" | "updated_at" | "stage_changed_at" | "university_name" | "application_deadline">;

/**
 * Total order: every sort ends on `id`, so two reads of the same rows (page load, then a
 * "Show more" request) always agree on which card is at which offset.
 */
export function sortApplications<T extends SortRow & { id: string }>(rows: T[], sort: ApplicationSort): T[] {
  const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const out = [...rows];
  out.sort((a, b) => primary(a, b) || cmpStr(a.id, b.id));
  return out;

  function primary(a: T, b: T): number {
    switch (sort) {
      case "newest":
        return cmpStr(b.created_at, a.created_at);
      case "updated":
        return cmpStr(b.updated_at, a.updated_at);
      case "university":
        return cmpStr(a.university_name.toLowerCase(), b.university_name.toLowerCase());
      case "deadline": {
        // soonest first; no deadline last
        if (!a.application_deadline && !b.application_deadline) return 0;
        if (!a.application_deadline) return 1;
        if (!b.application_deadline) return -1;
        return cmpStr(a.application_deadline, b.application_deadline);
      }
      case "stage":
      default:
        // longest in stage first = oldest stage_changed_at first
        return cmpStr(a.stage_changed_at, b.stage_changed_at);
    }
  }
}

// ── Runner ─────────────────────────────────────────────────────────────────────

export interface RunApplicationsQueryInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>;
  tenantId: string;
  scope: ApplicationsScope;
  tree: FilterTree;
  tab?: ApplicationsTab;
  /** The search box: ANDed with the whole tree (whatever its root conjunction), see planApplicationsQuery. */
  q?: string;
  ctx: CompileCtx;
  sort?: ApplicationSort;
  mode: "rows" | "count";
  /** rows mode only. Defaults to the full board select. */
  select?: string;
  /** Extra filters ANDed onto every branch query (GET /api/v1/applications' stage_id, status, …). */
  refine?: (b: ApplicationsBuilder) => ApplicationsBuilder;
  /** rows mode only: stop (and set `truncated`) past this many rows. Defaults to INDEX_ROW_CEILING. */
  maxRows?: number;
}

export type RunApplicationsQueryResult =
  | { ok: true; mode: "rows"; rows: Application[]; branches: number; truncated: boolean }
  | { ok: true; mode: "count"; count: number; branches: number }
  | { ok: false; error: string };

// 200 lead uuids ≈ 7.4 KB of query string: the URL stays under ~8 KB with the other filters.
const SCOPE_CHUNK = 200;

export async function runApplicationsQuery(input: RunApplicationsQueryInput): Promise<RunApplicationsQueryResult> {
  const { supabase, tenantId, scope, tree, ctx, mode } = input;
  const registry = applicationFields(ctx);

  // Validate the (cross-table-free) remainder up front so a bad tree is a chip error, not a 500.
  const planned = planApplicationsQuery(tree, input.tab, input.q);
  if (!planned.ok) return { ok: false, error: planned.error };
  const { plan } = planned;
  const valid = planFilter(plan.restTree, registry, ctx);
  if (!valid.ok) return { ok: false, error: Object.values(valid.errors).flat()[0] ?? "Filter couldn't be applied" };

  const branches = buildBranches(plan);
  if (scope.leadIds !== null && scope.leadIds.length === 0) {
    return mode === "count" ? { ok: true, mode, count: 0, branches: 0 } : { ok: true, mode, rows: [], branches: 0, truncated: false };
  }
  const chunks: (string[] | undefined)[] = scope.leadIds === null ? [undefined] : chunk(scope.leadIds, SCOPE_CHUNK);
  const select = input.select ?? APPLICATION_SELECT;

  const base = (lead: string[] | undefined): ApplicationsBuilder => {
    const from = supabase.from("applications");
    const q = (mode === "count" ? from.select("id, leads!applications_lead_id_fkey!inner(id)", { count: "exact", head: true }) : from.select(select))
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .is("leads.deleted_at", null);
    let b = q as unknown as ApplicationsBuilder;
    if (scope.teamMemberIds !== null) b = b.in("leads.assigned_to", scope.teamMemberIds);
    if (lead && lead.length > 0) b = b.in("lead_id", lead);
    return b;
  };

  const shape = (b: ApplicationsBuilder): ApplicationsBuilder => {
    let out = compileFilter(b, plan.restTree, registry, ctx);
    for (const ws of plan.studentWords) out = nameWordFilters(out, ws);
    if (plan.stuck) {
      out = out.lt("stage_changed_at", plan.stuck.cutoffIso);
      if (plan.stuck.finishedStageIds.length > 0) out = out.not("stage_id", "in", inList(plan.stuck.finishedStageIds));
    }
    return out;
  };

  if (branches.length === 0) {
    return mode === "count" ? { ok: true, mode, count: 0, branches: 0 } : { ok: true, mode, rows: [], branches: 0, truncated: false };
  }

  const refine = input.refine ?? ((b: ApplicationsBuilder) => b);
  const build = (lead: string[] | undefined, br: Branch) => br.apply(refine(shape(base(lead))));
  type Res = { data: unknown; count: number | null; error: { message: string } | null };

  if (mode === "count") {
    const results = await Promise.all(chunks.flatMap((lead) => branches.map((br) => build(lead, br) as unknown as PromiseLike<Res>)));
    const failed = results.find((r) => r.error);
    if (failed?.error) return { ok: false, error: failed.error.message };
    return { ok: true, mode, count: results.reduce((n, r) => n + (r.count ?? 0), 0), branches: branches.length };
  }

  // Rows: every (scope chunk x branch) query is read page by page until a short page comes back.
  // The query is rebuilt per page (a builder is single-use) and ordered by id so pages never
  // overlap or skip. One shared budget enforces the ceiling across the parallel calls.
  const ceiling = input.maxRows ?? INDEX_ROW_CEILING;
  let read = 0;
  let truncated = false;
  const readAll = async (lead: string[] | undefined, br: Branch): Promise<{ rows: Application[]; error: string | null }> => {
    const rows: Application[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      if (read >= ceiling) {
        truncated = true;
        return { rows, error: null };
      }
      const page = build(lead, br) as unknown as { order(c: string): { range(a: number, b: number): PromiseLike<Res> } };
      const r = await page.order("id").range(from, from + PAGE_SIZE - 1);
      if (r.error) return { rows, error: r.error.message };
      const got = (r.data ?? []) as Application[];
      rows.push(...got);
      read += got.length;
      if (got.length < PAGE_SIZE) return { rows, error: null };
    }
  };
  const results = await Promise.all(chunks.flatMap((lead) => branches.map((br) => readAll(lead, br))));
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error };

  const seen = new Set<string>();
  const merged: Application[] = [];
  for (const r of results) {
    for (const row of r.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
  }
  if (truncated) {
    console.error("[applications-query] index read hit the row ceiling; numbers are a lower bound", {
      tenantId, ceiling, rows: merged.length,
    });
  }
  return {
    ok: true, mode, rows: sortApplications(merged, input.sort ?? DEFAULT_APPLICATION_SORT), branches: branches.length, truncated,
  };
}

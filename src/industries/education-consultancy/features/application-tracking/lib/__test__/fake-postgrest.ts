// TEST-ONLY in-memory PostgREST stand-in (moved out of the old applications-fixture page, fix round 2 A4).
// Never import this from app code: applications-test-only.test.ts fails the suite if a non-test file does.
//
// It understands the filter shapes the applications query helpers emit (eq/neq/is/in/lt/gt/gte/lte/ilike/
// contains/overlaps/not/or with referencedTable, order, range), and — like the real server — caps every
// response at `maxRows` (1000, supabase/config.toml), silently.

type Row = Record<string, unknown>;
type Pred = (r: Row) => boolean;

const col = (r: Row, c: string): unknown => {
  const dot = c.indexOf(".");
  if (dot < 0) return r[c];
  const parent = r[c.slice(0, dot)] as Row | null | undefined;
  return parent ? parent[c.slice(dot + 1)] : undefined;
};
const unq = (s: string) => s.replace(/^"|"$/g, "");
const list = (s: string) => s.replace(/^\(|\)$/g, "").split(",").map(unq);
const like = (p: string) => new RegExp(`^${unq(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "is");
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function leg(expr: string, table: string | null): Pred {
  const m = expr.match(/^([a-z_]+)\.(not\.)?(is|in|ilike|eq|neq|ov|cs|lt|gt|gte|lte)\.(.*)$/);
  if (!m) throw new Error(`fake-postgrest: unsupported or-leg "${expr}"`);
  const [, c, neg, op, raw] = m;
  const name = table ? `${table}.${c}` : c;
  const base: Pred = (r) => {
    const v = col(r, name);
    switch (op) {
      case "is":
        return raw === "null" ? v === null || v === undefined : String(v) === raw;
      case "in":
        return list(raw).includes(str(v));
      case "ilike":
        return typeof v === "string" && like(raw).test(v);
      case "eq":
        return str(v) === unq(raw);
      case "neq":
        return str(v) !== unq(raw);
      case "ov":
        return arr(v).some((x) => list(raw.replace(/^\{|\}$/g, "")).includes(x));
      case "cs":
        return list(raw.replace(/^\{|\}$/g, "")).every((x) => arr(v).includes(x));
      case "lt":
        return v !== null && v !== undefined && str(v) < unq(raw);
      case "gt":
        return v !== null && v !== undefined && str(v) > unq(raw);
      case "gte":
        return v !== null && v !== undefined && str(v) >= unq(raw);
      default:
        return v !== null && v !== undefined && str(v) <= unq(raw);
    }
  };
  return neg ? (r) => !base(r) : base;
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function expr(e: string, table: string | null): Pred {
  const g = e.match(/^(and|or)\((.*)\)$/);
  if (g) {
    const parts = splitTop(g[2]).map((x) => expr(x, table));
    return g[1] === "and" ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  return leg(e, table);
}

export interface FakeQueryLog {
  table: string;
  head: boolean;
  /** Rough length of the query string PostgREST would see (filters + order + range). */
  urlLength: number;
  rows: number;
}

type Result = { data: unknown; count: number | null; error: null };

class Query implements PromiseLike<Result> {
  private preds: Pred[] = [];
  private qs: string[] = [];
  private orderCol: string | null = null;
  private orderAsc = true;
  private from: number | null = null;
  private to: number | null = null;

  constructor(
    private table: string,
    private rows: Row[],
    private head: boolean,
    private wantCount: boolean,
    private maxRows: number,
    private log: FakeQueryLog[],
  ) {}

  private add(p: Pred, q: string) {
    this.preds.push(p);
    this.qs.push(q);
    return this;
  }
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    return this.add((r) => str(col(r, c)) === str(v), `${c}=eq.${str(v)}`);
  }
  neq(c: string, v: unknown) {
    return this.add((r) => str(col(r, c)) !== str(v), `${c}=neq.${str(v)}`);
  }
  is(c: string, v: unknown) {
    return this.add((r) => (v === null ? col(r, c) === null || col(r, c) === undefined : col(r, c) === v), `${c}=is.${String(v)}`);
  }
  in(c: string, v: readonly unknown[]) {
    const set = new Set(v.map(str));
    return this.add((r) => set.has(str(col(r, c))), `${c}=in.(${v.map(str).join(",")})`);
  }
  gt(c: string, v: unknown) {
    return this.add((r) => col(r, c) != null && str(col(r, c)) > str(v), `${c}=gt.${str(v)}`);
  }
  gte(c: string, v: unknown) {
    return this.add((r) => col(r, c) != null && str(col(r, c)) >= str(v), `${c}=gte.${str(v)}`);
  }
  lt(c: string, v: unknown) {
    return this.add((r) => col(r, c) != null && str(col(r, c)) < str(v), `${c}=lt.${str(v)}`);
  }
  lte(c: string, v: unknown) {
    return this.add((r) => col(r, c) != null && str(col(r, c)) <= str(v), `${c}=lte.${str(v)}`);
  }
  ilike(c: string, p: string) {
    return this.add((r) => like(p).test(str(col(r, c))), `${c}=ilike.${p}`);
  }
  contains(c: string, v: readonly unknown[]) {
    return this.add((r) => (v as string[]).every((x) => arr(col(r, c)).includes(x)), `${c}=cs.{${v.join(",")}}`);
  }
  overlaps(c: string, v: readonly unknown[]) {
    return this.add((r) => arr(col(r, c)).some((x) => (v as string[]).includes(x)), `${c}=ov.{${v.join(",")}}`);
  }
  not(c: string, op: string, v: unknown) {
    const p = leg(`${c.includes(".") ? c.split(".").pop() : c}.${op}.${String(v)}`, c.includes(".") ? c.split(".")[0] : null);
    return this.add((r) => !p(r), `${c}=not.${op}.${String(v)}`);
  }
  or(f: string, o?: { referencedTable?: string }) {
    return this.add(expr(`or(${f})`, o?.referencedTable ?? null), `${o?.referencedTable ? `${o.referencedTable}.` : ""}or=(${f})`);
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orderCol = c;
    this.orderAsc = o?.ascending !== false;
    this.qs.push(`order=${c}`);
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  maybeSingle() {
    return this.run().then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : null }));
  }

  private run(): Promise<Result> {
    let hit = this.rows.filter((r) => this.preds.every((p) => p(r)));
    const count = hit.length;
    if (this.orderCol) {
      const c = this.orderCol;
      const dir = this.orderAsc ? 1 : -1;
      hit = [...hit].sort((a, b) => (str(col(a, c)) < str(col(b, c)) ? -dir : str(col(a, c)) > str(col(b, c)) ? dir : 0));
    }
    const start = this.from ?? 0;
    const end = Math.min(this.to === null ? Infinity : this.to + 1, start + this.maxRows);
    const page = this.head ? null : hit.slice(start, end);
    this.log.push({ table: this.table, head: this.head, urlLength: this.qs.join("&").length, rows: page?.length ?? 0 });
    return Promise.resolve({ data: page, count: this.wantCount || this.head ? count : null, error: null });
  }

  then<T1 = Result, T2 = never>(ok?: ((v: Result) => T1 | PromiseLike<T1>) | null, bad?: ((e: unknown) => T2 | PromiseLike<T2>) | null) {
    return this.run().then(ok, bad);
  }
}

export interface FakeSupabase {
  from(table: string): { select(cols?: string, opts?: { count?: string; head?: boolean }): Query };
  log: FakeQueryLog[];
}

/** `tables`: rows per table. Embedded resources (e.g. `leads`) live on each row as a nested object. */
export function createFakeSupabase(tables: Record<string, Row[]>, opts: { maxRows?: number } = {}): FakeSupabase {
  const maxRows = opts.maxRows ?? 1000;
  const log: FakeQueryLog[] = [];
  return {
    log,
    from(table: string) {
      return {
        select: (_cols?: string, o?: { count?: string; head?: boolean }) =>
          new Query(table, tables[table] ?? [], !!o?.head, !!o?.count, maxRows, log),
      };
    },
  };
}

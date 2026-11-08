import type { ProcessesDb } from "../context";

/**
 * A small in-memory stand-in for the scoped client, for the improver tests only. Like the real wrapper it injects the tenant filter on
 * every `from()` read, update and delete and stamps the tenant on every insert, so a test can prove the tools never reach another tenant's
 * rows. `fromGlobal` is unfiltered (tenants). `raw().rpc` records its calls and returns the configured payloads.
 */
type Row = Record<string, unknown>;
export interface FakeWorld {
  rows: Record<string, Row[]>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  inserts: Array<{ table: string; row: Row }>;
  db: ProcessesDb;
}

export function fakeWorld(tenantId: string, rows: Record<string, Row[]>, rpcResults: Record<string, unknown> = {}): FakeWorld {
  const world: FakeWorld = { rows, rpcs: [], inserts: [], db: null as never };
  let seq = 0;

  const builder = (table: string, scoped: boolean) => {
    let pick: Row[] = (rows[table] ?? []).filter((r) => !scoped || r.tenant_id === tenantId);
    let mode: "read" | "delete" | "update" = "read";
    let patch: Row | null = null;
    const q: Record<string, unknown> = {};
    const filter = (fn: (r: Row) => boolean) => {
      pick = pick.filter(fn);
      return q;
    };
    const finish = () => {
      if (mode === "delete") rows[table] = (rows[table] ?? []).filter((r) => !pick.includes(r));
      if (mode === "update" && patch) for (const r of pick) Object.assign(r, patch);
      return { data: pick, error: null, count: pick.length };
    };
    Object.assign(q, {
      select: () => q,
      eq: (c: string, v: unknown) => filter((r) => r[c] === v),
      in: (c: string, vs: unknown[]) => filter((r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filter((r) => (v === null ? r[c] == null : r[c] === v)),
      gte: (c: string, v: string) => filter((r) => String(r[c] ?? "") >= v),
      lte: (c: string, v: string) => filter((r) => String(r[c] ?? "") <= v),
      order: (c: string, o?: { ascending?: boolean }) => {
        pick = [...pick].sort((a, b) => (Number(a[c]) < Number(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1));
        return q;
      },
      limit: (n: number) => {
        pick = pick.slice(0, n);
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: pick[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: pick[0] ?? null, error: pick[0] ? null : { message: "no row" } }),
      delete: () => {
        mode = "delete";
        return q;
      },
      update: (p: Row) => {
        mode = "update";
        patch = p;
        return q;
      },
      insert: (row: Row) => {
        const stored = { id: `${table}-${++seq}`, ...row, ...(scoped ? { tenant_id: tenantId } : {}) };
        (rows[table] ??= []).push(stored);
        world.inserts.push({ table, row: stored });
        pick = [stored];
        return q;
      },
      then: (res: (v: unknown) => unknown) => res(finish()),
    });
    return q;
  };

  world.db = {
    from: (t: string) => builder(t, true),
    fromGlobal: (t: string) => builder(t, false),
    raw: () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        world.rpcs.push({ name, args });
        return { data: rpcResults[name] ?? null, error: null };
      },
    }),
  } as unknown as ProcessesDb;
  return world;
}

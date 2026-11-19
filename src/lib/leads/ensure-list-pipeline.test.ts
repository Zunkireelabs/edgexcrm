// Client report (Manish, Nov 2026): a Stage created from "Add/Edit stages" ("Enrolled") shows up but no lead can be
// moved into it, because it has no pipeline (statuses). ensureListPipeline builds one — mocked client, no DB.
import { describe, it, expect } from "vitest";
import { ensureListPipeline, DEFAULT_LIST_STATUSES } from "./ensure-list-pipeline";

type Call = { table: string; op: string; payload?: unknown };

// Minimal chainable fake of the supabase query builder. `script` decides what each terminal call resolves to.
function fakeClient(opts: {
  currentPipelineId?: string | null; // what lead_lists.pipeline_id reads as
  linkRows?: number; // rows the guarded link update affects
  pipelineInsertError?: boolean;
  stagesInsertError?: boolean;
}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      let op = "select";
      let payload: unknown;
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["eq", "is", "order", "limit", "in"]) b[m] = chain;
      b.select = () => b;
      b.insert = (p: unknown) => { op = "insert"; payload = p; return b; };
      b.update = (p: unknown) => { op = "update"; payload = p; return b; };
      b.delete = () => { op = "delete"; return b; };
      const settle = () => {
        calls.push({ table, op, payload });
        if (table === "lead_lists" && op === "select") return { data: { pipeline_id: opts.currentPipelineId ?? null }, error: null };
        if (table === "pipelines" && op === "select") return { data: { position: 2 }, error: null };
        if (table === "pipelines" && op === "insert") return opts.pipelineInsertError ? { data: null, error: { message: "x" } } : { data: { id: "pipe-new" }, error: null };
        if (table === "pipeline_stages" && op === "insert") return { data: null, error: opts.stagesInsertError ? { message: "x" } : null };
        if (table === "lead_lists" && op === "update") return { data: Array.from({ length: opts.linkRows ?? 1 }, () => ({ id: "l" })), error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = async () => settle();
      b.single = async () => settle();
      (b as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(settle()).then(res);
      return b;
    },
  };
  return { client: client as never, calls };
}

const LIST = { id: "list-1234abcd", slug: "enrolled", name: "Enrolled", pipeline_id: null };

describe("ensureListPipeline", () => {
  it("returns the existing pipeline without creating anything", async () => {
    const { client, calls } = fakeClient({});
    expect(await ensureListPipeline(client, "t1", { ...LIST, pipeline_id: "p-old" })).toBe("p-old");
    expect(calls).toHaveLength(0);
  });

  it("creates a pipeline with the default statuses and links it to the list", async () => {
    const { client, calls } = fakeClient({});
    expect(await ensureListPipeline(client, "t1", LIST)).toBe("pipe-new");
    const stages = calls.find((c) => c.table === "pipeline_stages" && c.op === "insert")!.payload as { slug: string; is_default: boolean }[];
    expect(stages.map((s) => s.slug)).toEqual(DEFAULT_LIST_STATUSES.map((s) => s.slug));
    expect(stages.filter((s) => s.is_default)).toHaveLength(1);
    const pipe = calls.find((c) => c.table === "pipelines" && c.op === "insert")!.payload as { list_id: string; is_default: boolean; position: number };
    expect(pipe).toMatchObject({ list_id: "list-1234abcd", is_default: false, position: 3 });
    expect(calls.some((c) => c.table === "lead_lists" && c.op === "update" && (c.payload as { pipeline_id: string }).pipeline_id === "pipe-new")).toBe(true);
  });

  it("uses the pipeline another request already linked (re-read)", async () => {
    const { client, calls } = fakeClient({ currentPipelineId: "p-winner" });
    expect(await ensureListPipeline(client, "t1", LIST)).toBe("p-winner");
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("loses a race at link time: drops its own pipeline and returns the winner's", async () => {
    // first read null (so we proceed), link affects 0 rows, second read returns the winner
    let reads = 0;
    const { client, calls } = fakeClient({ linkRows: 0 });
    const orig = (client as { from: (t: string) => unknown }).from.bind(client);
    (client as { from: (t: string) => unknown }).from = (t: string) => {
      const b = orig(t) as { maybeSingle: () => Promise<unknown> };
      const mb = b.maybeSingle;
      if (t === "lead_lists") b.maybeSingle = async () => (++reads === 1 ? mb() : { data: { pipeline_id: "p-winner" }, error: null });
      return b;
    };
    expect(await ensureListPipeline(client, "t1", LIST)).toBe("p-winner");
    expect(calls.some((c) => c.table === "pipelines" && c.op === "delete")).toBe(true);
  });

  it("returns null and cleans up when the statuses can't be created", async () => {
    const { client, calls } = fakeClient({ stagesInsertError: true });
    expect(await ensureListPipeline(client, "t1", LIST)).toBeNull();
    expect(calls.some((c) => c.table === "pipelines" && c.op === "delete")).toBe(true);
  });

  it("returns null when the pipeline itself can't be created", async () => {
    const { client } = fakeClient({ pipelineInsertError: true });
    expect(await ensureListPipeline(client, "t1", LIST)).toBeNull();
  });
});

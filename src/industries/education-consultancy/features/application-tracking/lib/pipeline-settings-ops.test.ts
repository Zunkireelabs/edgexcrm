import { describe, it, expect, vi } from "vitest";
import { diffToOps, hasChanges, runSettingsOps, type DraftState, type DraftStage } from "./pipeline-settings-ops";

const st = (key: string, o: Partial<DraftStage> = {}): DraftStage => ({
  key, name: key.toUpperCase(), color: "#3b82f6", is_default: false, is_terminal: false, terminal_type: null, ...o,
});
const original = (): DraftState => ({
  name: "Default", is_default: true,
  stages: [st("a", { is_default: true }), st("b"), st("c"), st("w", { is_terminal: true, terminal_type: "won" })],
});
const clone = (d: DraftState): DraftState => JSON.parse(JSON.stringify(d));

describe("diffToOps", () => {
  it("no edits means no calls", () => {
    expect(diffToOps(original(), clone(original()))).toEqual([]);
    expect(hasChanges(original(), clone(original()))).toBe(false);
  });

  it("emits adds, patches, reorder, deletes, pipeline in that order", () => {
    const d = clone(original());
    d.stages.find((s) => s.key === "b")!.name = "B2"; // patch
    d.stages.push(st("new:1", { name: "Fresh" })); // add
    d.stages = d.stages.filter((s) => s.key !== "c"); // delete
    d.stages.reverse(); // reorder
    d.name = "Renamed"; // pipeline
    expect(diffToOps(original(), d).map((o) => o.kind)).toEqual(["add", "patch", "reorder", "delete", "pipeline"]);
  });

  it("a new stage that is deleted again makes no calls", () => {
    const d = clone(original());
    d.stages.push(st("new:1"));
    d.stages = d.stages.filter((s) => s.key !== "new:1");
    expect(diffToOps(original(), d)).toEqual([]);
  });

  it("a renamed-then-deleted stage produces only the delete", () => {
    const d = clone(original());
    d.stages.find((s) => s.key === "b")!.name = "Renamed";
    d.stages = d.stages.filter((s) => s.key !== "b");
    expect(diffToOps(original(), d)).toEqual([{ kind: "delete", stageId: "b", label: 'Delete "B"' }]);
  });

  it("add-at-the-end alone needs no reorder; moving the new stage up does", () => {
    const d = clone(original());
    d.stages.push(st("new:1"));
    expect(diffToOps(original(), d).map((o) => o.kind)).toEqual(["add"]);
    d.stages.unshift(d.stages.pop()!);
    expect(diffToOps(original(), d).map((o) => o.kind)).toEqual(["add", "reorder"]);
  });

  it("reorder lists every stage, with to-be-deleted ones at the end (the endpoint demands all of them)", () => {
    const d = clone(original());
    d.stages = d.stages.filter((s) => s.key !== "c");
    [d.stages[0], d.stages[1]] = [d.stages[1], d.stages[0]];
    const r = diffToOps(original(), d).find((o) => o.kind === "reorder");
    expect(r && r.kind === "reorder" && r.keys).toEqual(["b", "a", "w", "c"]);
  });

  it("moving a stage to Finished / back patches terminal_type; Start change patches is_default", () => {
    const d = clone(original());
    Object.assign(d.stages.find((s) => s.key === "b")!, { is_terminal: true, terminal_type: "won" });
    Object.assign(d.stages.find((s) => s.key === "w")!, { is_terminal: false, terminal_type: null });
    d.stages.find((s) => s.key === "a")!.is_default = false;
    d.stages.find((s) => s.key === "c")!.is_default = true;
    const bodies = diffToOps(original(), d).map((o) => (o.kind === "patch" ? [o.stageId, o.body] : null)).filter(Boolean);
    expect(bodies).toEqual([["b", { terminal_type: "won" }], ["c", { is_default: true }], ["w", { terminal_type: null }]]);
  });
});

describe("a new stage marked Start", () => {
  it("is added, then patched is_default right after (the add alone would lose it)", () => {
    const d = clone(original());
    d.stages.forEach((x) => (x.is_default = false));
    d.stages.push(st("new:1", { name: "Fresh", is_default: true }));
    const ops = diffToOps(original(), d);
    expect(ops.map((o) => o.kind)).toEqual(["add", "patch"]);
    expect(ops[1]).toMatchObject({ kind: "patch", stageId: "new:1", body: { is_default: true } });
  });

  it("the patch hits the real id returned by the add", async () => {
    const d = clone(original());
    d.stages.push(st("new:1", { is_default: true }));
    const calls: string[] = [];
    await runSettingsOps(diffToOps(original(), d), "p1", async (method, path) => {
      calls.push(`${method} ${path}`);
      return { ok: true, status: 200, json: { data: { id: "REAL1" } } };
    });
    expect(calls).toEqual(["POST /api/v1/application-pipelines/p1/stages", "PATCH /api/v1/application-pipelines/p1/stages/REAL1"]);
  });
});

describe("runSettingsOps", () => {
  const ok = (json: unknown = {}) => ({ ok: true, status: 200, json });

  it("runs in order, mapping a new stage's real id into the reorder", async () => {
    const d = clone(original());
    d.stages.unshift(st("new:1", { name: "Fresh" }));
    const calls: string[] = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push(`${method} ${path} ${JSON.stringify(body)}`);
      return ok(path.endsWith("/stages") ? { data: { id: "REAL1" } } : {});
    });
    const r = await runSettingsOps(diffToOps(original(), d), "p1", request);
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toContain("POST /api/v1/application-pipelines/p1/stages ");
    expect(calls[1]).toBe('POST /api/v1/application-pipelines/p1/stages/reorder {"stage_ids":["REAL1","a","b","c","w"]}');
  });

  it("stops at the first failure and reports it", async () => {
    const d = clone(original());
    d.stages.find((s) => s.key === "a")!.name = "A2";
    d.stages.find((s) => s.key === "b")!.name = "B2";
    const request = vi.fn(async () => ({ ok: false, status: 500, json: { error: { message: "boom" } } }));
    const r = await runSettingsOps(diffToOps(original(), d), "p1", request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, message: "boom", done: 0 });
  });

  it("makes no calls when there is nothing to save", async () => {
    const request = vi.fn();
    expect(await runSettingsOps([], "p1", request)).toEqual({ ok: true });
    expect(request).not.toHaveBeenCalled();
  });
});

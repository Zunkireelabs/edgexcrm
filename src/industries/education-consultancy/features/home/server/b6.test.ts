import { describe, it, expect, vi, beforeEach } from "vitest";

const { memberMock } = vi.hoisted(() => ({ memberMock: vi.fn() }));
vi.mock("@/lib/leads/branch-membership", () => ({ branchMemberIds: memberMock }));

import { loadAgentDrafts, loadOrcaDraftCounts } from "./b6";

/** A chainable stand-in: records every call, resolves to `rows` when awaited. */
function builder(rows: unknown[], log: Array<[string, unknown[]]> = []) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "is", "gte", "lt", "limit", "order"]) b[k] = (...a: unknown[]) => (log.push([k, a]), b);
  b.maybeSingle = async () => ({ data: rows[0] ?? null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}

describe("loadAgentDrafts: proposed message drafts in the viewer's scope", () => {
  const OUT = [
    { id: "o1", agent_id: "ag1", subject_type: "lead", subject_id: "lead-pokhara" },
    { id: "o2", agent_id: "ag1", subject_type: "lead", subject_id: "lead-pokhara-2" },
    { id: "o3", agent_id: "ag2", subject_type: "lead", subject_id: "lead-kathmandu" },
  ];
  const dbFor = (outputs: unknown[], log: Array<[string, unknown[]]> = []) =>
    ({ from: (t: string) => (t === "agent_outputs" ? builder(outputs, log) : builder([{ display_name: "Follow-up agent" }])) }) as never;
  const scopeOf = (definition: "tenant" | "branch-visibility", visibleIds: string[]) => ({ definition, select: () => builder(visibleIds.map((id) => ({ id }))) }) as never;

  it("owner on Overall counts every proposed draft_email, with the top agent's name", async () => {
    const log: Array<[string, unknown[]]> = [];
    const r = await loadAgentDrafts(dbFor(OUT, log), scopeOf("tenant", []));
    expect(r).toEqual({ count: 3, agentName: "Follow-up agent", reviewHref: "/orca/review" });
    expect(log).toContainEqual(["eq", ["status", "proposed"]]);
    expect(log).toContainEqual(["eq", ["kind", "draft_email"]]);
  });
  it("a branch manager counts ONLY drafts whose lead is in their branch scope", async () => {
    const r = await loadAgentDrafts(dbFor(OUT), scopeOf("branch-visibility", ["lead-pokhara", "lead-pokhara-2"]));
    expect(r?.count).toBe(2);
  });
  it("none in the branch: null (the row does not show)", async () => {
    expect(await loadAgentDrafts(dbFor(OUT), scopeOf("branch-visibility", []))).toBeNull();
  });
  it("a draft with no lead subject never counts for a branch", async () => {
    expect(await loadAgentDrafts(dbFor([{ id: "o9", agent_id: "ag1", subject_type: null, subject_id: null }]), scopeOf("branch-visibility", ["x"]))).toBeNull();
  });
  it("Admizz today: no agent_outputs at all: null", async () => {
    expect(await loadAgentDrafts(dbFor([]), scopeOf("tenant", []))).toBeNull();
  });
});

describe("loadOrcaDraftCounts: drafts the person finished, from ai_drafts", () => {
  const W = { from: new Date("2026-11-19T00:00:00Z"), to: new Date("2026-12-10T00:00:00Z") };
  beforeEach(() => memberMock.mockReset());
  const dbWith = (rows: unknown[], log: Array<[string, unknown[]]>) => ({ from: () => builder(rows, log), raw: () => ({}) }) as never;

  it("counts sent_as_is / edited / discarded; message-draft surfaces only; the window on resolved_at", async () => {
    const log: Array<[string, unknown[]]> = [];
    const rows = [...Array(16).fill({ outcome: "sent_as_is" }), ...Array(7).fill({ outcome: "edited" }), ...Array(2).fill({ outcome: "discarded" })];
    expect(await loadOrcaDraftCounts(dbWith(rows, log), "t1", W, null)).toEqual({ sent: 16, edited: 7, discarded: 2 });
    expect(log).toContainEqual(["in", ["surface", ["home_draft", "home_batch"]]]);
    expect(log).toContainEqual(["in", ["outcome", ["sent_as_is", "edited", "discarded"]]]);
    expect(log).toContainEqual(["gte", ["resolved_at", W.from.toISOString()]]);
    expect(log).toContainEqual(["lt", ["resolved_at", W.to.toISOString()]]);
    expect(memberMock).not.toHaveBeenCalled(); // owner on Overall: everyone
  });
  it("a branch manager sees only their branch's counsellors", async () => {
    memberMock.mockResolvedValue(["u1", "u2"]);
    const log: Array<[string, unknown[]]> = [];
    await loadOrcaDraftCounts(dbWith([], log), "t1", W, "branch-1");
    expect(log).toContainEqual(["in", ["user_id", ["u1", "u2"]]]);
  });
  it("a branch with no members counts nothing and asks nothing", async () => {
    memberMock.mockResolvedValue([]);
    const log: Array<[string, unknown[]]> = [];
    expect(await loadOrcaDraftCounts(dbWith([], log), "t1", W, "branch-1")).toEqual({ sent: 0, edited: 0, discarded: 0 });
    expect(log).toEqual([]);
  });
});

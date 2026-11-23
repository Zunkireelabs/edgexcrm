import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sliceAssignments, unassignedRow, type NeedsAction } from "../needs-you";
import { classifyHumanAssignment } from "./outcome";
import { buildAttention } from "../../../pulse/lib/attention";
import { computeSignals } from "../../../pulse/lib/signals";
import { DEFAULT_PULSE_THRESHOLDS as T } from "../../../pulse/lib/thresholds";
import type { Candidate, Team } from "./score";
import { suggestAssignments, suggestionNames, type SuggestLead } from "./suggest";

const team: Team = { byDestination: {}, overall: { received: 0, progressed: 0 }, medianFirstContactMin: null };
const zero = { received: 0, progressed: 0, speedN: 0, medianFirstContactMin: null };

function cand(userId: string, name: string, over: Partial<Candidate> = {}): Candidate {
  return {
    userId, name, positionKey: "counsellor", branchId: "kt", active: true, onLeave: false, dormant: false, flag7d: "green",
    heldOpen: 10, receivedToday: 0, overall: zero, byDestination: {}, present: true, ...over,
  };
}
const lead = (id: string, createdAt: string, over: Partial<SuggestLead> = {}): SuggestLead => ({ id, created_at: createdAt, branch_id: null, destinations: null, ...over });
const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(`l${i + 1}`, `2026-11-0${(i % 9) + 1}T00:00:00Z`));

describe("suggestAssignments (what smart assignment WOULD do; the same engine as the real run)", () => {
  it("picks only from the pool it is given (Counselor + Lead Executive here), never anyone else", () => {
    const pool = [cand("c1", "Diplov", { positionKey: "counsellor" }), cand("e1", "Gautam", { positionKey: "lead-executive" })];
    const s = suggestAssignments(leads(4), pool, team);
    expect(s.placed).toBe(4);
    expect(s.assignments.every((a) => ["c1", "e1"].includes(a.userId))).toBe(true);
  });

  it("spreads: each pick is added to that person's load before the next lead, so one person does not take everything", () => {
    const pool = [cand("a", "Diplov", { heldOpen: 10 }), cand("b", "Gautam", { heldOpen: 10 })];
    const s = suggestAssignments(leads(6), pool, team);
    expect(s.assignments.map((a) => a.take).sort()).toEqual([3, 3]);
    expect(s.unplaced).toBe(0);
    expect(s.reason).toBeNull();
  });

  it("hands leads out oldest first", () => {
    const pool = [cand("a", "Diplov")];
    const s = suggestAssignments([lead("new", "2026-11-08T00:00:00Z"), lead("old", "2026-11-01T00:00:00Z")], pool, team);
    expect(s.assignments[0].leadIds).toEqual(["old", "new"]);
  });

  it("nobody available → nothing placed, and the engine's own reason (its filter summary)", () => {
    const pool = [cand("a", "Asha", { onLeave: true }), cand("b", "Bina", { onLeave: true }), cand("c", "Chirag", { active: false })];
    const s = suggestAssignments(leads(3), pool, team);
    expect(s.placed).toBe(0);
    expect(s.assignments).toEqual([]);
    expect(s.unplaced).toBe(3);
    expect(s.reason).toBe("2 on leave, 1 suspended");
  });

  it("an empty pool reports the engine's pool-empty sentence", () => {
    const s = suggestAssignments(leads(2), [], team);
    expect(s.placed).toBe(0);
    expect(s.reason).toMatch(/No one is in the first-touch positions/);
  });

  it("partly placeable: places what it can and counts the rest, with the engine's reason for those", () => {
    // The Butwal lead's branch is staffed only by someone on leave, so it has no taker; the Kathmandu lead does.
    const pool = [cand("kt1", "Diplov", { branchId: "kt" }), cand("bt1", "Gautam", { branchId: "bt", onLeave: true })];
    const s = suggestAssignments([lead("l1", "2026-11-01T00:00:00Z", { branch_id: "kt" }), lead("l2", "2026-11-02T00:00:00Z", { branch_id: "bt" })], pool, team);
    expect(s.placed).toBe(1);
    expect(s.unplaced).toBe(1);
    expect(s.assignments).toEqual([{ userId: "kt1", name: "Diplov", take: 1, leadIds: ["l1"] }]);
    expect(s.reason).toMatch(/on leave/);
  });

  it("a branch manager's suggestion stays inside their branch", () => {
    const pool = [cand("kt1", "Diplov", { branchId: "kt" }), cand("bt1", "Gautam", { branchId: "bt", heldOpen: 0 })];
    const s = suggestAssignments(leads(4), pool, team, { branchId: "kt" });
    expect(s.assignments.map((a) => a.userId)).toEqual(["kt1"]);
    // Without the pin, the person with the most room (Gautam, in another branch) is in the race.
    expect(suggestAssignments(leads(4), pool, team).assignments.some((a) => a.userId === "bt1")).toBe(true);
  });

  it("writes nothing: the pool the caller passed in is untouched", () => {
    const pool = [cand("a", "Diplov"), cand("b", "Gautam")];
    const before = JSON.stringify(pool);
    suggestAssignments(leads(5), pool, team);
    expect(JSON.stringify(pool)).toBe(before);
  });
});

describe("Home and Pulse return the same suggestion for one input", () => {
  it("the Home row and Pulse's untouched row name the same people with the same counts", () => {
    const pool = [cand("a", "Diplov"), cand("b", "Gautam")];
    const s = suggestAssignments(leads(4), pool, team);
    const names = s.assignments.map((a) => `${a.name} +${a.take}`).join(", ");

    const home = unassignedRow({ count: 4, oldestAt: null, now: new Date("2026-11-09T00:00:00Z"), suggestion: s, leadIds: s.assignments.flatMap((a) => a.leadIds), chooseHref: "/l" })!;
    expect(home.why).toContain(names);

    const signals = computeSignals({ people: [], stageFlows: [], untouched: { count: 4, byPerson: [] }, branchKpis: [], thresholds: T }).all;
    const pulse = buildAttention({ people: [], signals, stageFlows: [], leakReasons: {}, staleHeld: {}, untouched: { count: 4, listIds: ["intake"], byBranch: [], byRole: [] }, newLeadSuggestion: s }).find((i) => i.id === "untouched_leads")!;
    expect(pulse.why).toContain(names);
  });
});

describe("stored shadow picks drive the suggestion (click-through round 4, I)", () => {
  const two = [lead("l1", "2026-11-01T00:00:00Z"), lead("l2", "2026-11-02T00:00:00Z")];
  it("two leads the engine gave to A: the suggestion is 'A +2', and pressing the button records both as matched", () => {
    const stored = new Map([["l1", "a"], ["l2", "a"]]);
    const s = suggestAssignments(two, [cand("a", "Gautam"), cand("b", "Nikhil")], team, { storedPicks: stored });
    expect(suggestionNames(s.assignments)).toBe("Gautam +2");
    const pressed = sliceAssignments(s.assignments.flatMap((a) => a.leadIds), s.assignments).flatMap((x) => x.ids.map((id) => classifyHumanAssignment({ mode: "shadow", pickedUserId: stored.get(id) as string, outcome: null }, x.userId)));
    expect(pressed).toEqual(["matched", "matched"]);
  });
  it("a mix: stored picks stay put and count towards the load before the undecided leads are spread", () => {
    const s = suggestAssignments([...two, lead("l3", "2026-11-03T00:00:00Z")], [cand("a", "Gautam"), cand("b", "Nikhil")], team, { storedPicks: new Map([["l1", "a"], ["l2", "a"]]) });
    expect(s.assignments.find((x) => x.userId === "a")?.leadIds).toEqual(["l1", "l2"]);
    expect(s.assignments.find((x) => x.userId === "b")?.leadIds).toEqual(["l3"]);
    expect(s.placed).toBe(3);
  });
  it("a stored pick wins over today's cap (the burst it recorded is the point)", () => {
    const s = suggestAssignments(two, [cand("a", "Gautam", { receivedToday: 50 }), cand("b", "Nikhil")], team, { storedPicks: new Map([["l1", "a"], ["l2", "a"]]) });
    expect(s.assignments).toEqual([expect.objectContaining({ userId: "a", take: 2 })]);
  });
  it.each([["on leave", { onLeave: true }], ["suspended", { active: false }], ["dormant", { dormant: true }], ["flagged", { flag7d: "red" as const }]])("a pick whose person is now %s is spread like any other lead", (_w, over) => {
    const s = suggestAssignments(two, [cand("a", "Gautam", over), cand("b", "Nikhil")], team, { storedPicks: new Map([["l1", "a"], ["l2", "a"]]) });
    expect(s.assignments).toEqual([expect.objectContaining({ userId: "b", take: 2 })]);
  });
  it("a pick outside this pool (another branch, or gone) is spread inside the pool", () => {
    const s = suggestAssignments(two, [cand("a", "Gautam", { branchId: "bt" }), cand("b", "Nikhil", { branchId: "kt" })], team, { branchId: "kt", storedPicks: new Map([["l1", "a"], ["l2", "gone"]]) });
    expect(s.assignments).toEqual([expect.objectContaining({ userId: "b", take: 2 })]);
  });
  it("no stored picks (auto, off): the plain spread, unchanged", () => {
    const pool = [cand("a", "Gautam"), cand("b", "Nikhil")];
    expect(suggestAssignments(leads(6), pool, team, { storedPicks: new Map() })).toEqual(suggestAssignments(leads(6), pool, team));
  });
});

describe("suggestion order (click-through round 4, K)", () => {
  const burst = ["d", "k", "n", "g", "d", "k", "n", "g", "d", "n"];
  const ls = burst.map((_, i) => lead(`b${i}`, `2026-11-01T00:${String(i).padStart(2, "0")}:00Z`));
  const pool = [cand("d", "Diplov"), cand("k", "Kamana"), cand("n", "Nikhil"), cand("g", "Gautam")];
  const s = suggestAssignments(ls, pool, team, { storedPicks: new Map(burst.map((u, i) => [`b${i}`, u])) });
  it("biggest first, ties in pick order", () => {
    expect(suggestionNames(s.assignments)).toBe("Diplov +3, Nikhil +3, Kamana +2, Gautam +2");
  });
  it("Home and Pulse read the same, and each person still gets exactly their own leads", () => {
    const home = unassignedRow({ count: 10, oldestAt: null, now: new Date("2026-11-09T00:00:00Z"), suggestion: s, leadIds: ls.map((l) => l.id), chooseHref: "/l" })!;
    expect(home.why).toContain("Diplov +3, Nikhil +3, Kamana +2, Gautam +2");
    const signals = computeSignals({ people: [], stageFlows: [], untouched: { count: 10, byPerson: [] }, branchKpis: [], thresholds: T }).all;
    const pulse = buildAttention({ people: [], signals, stageFlows: [], leakReasons: {}, staleHeld: {}, untouched: { count: 10, listIds: ["intake"], byBranch: [], byRole: [] }, newLeadSuggestion: s }).find((i) => i.id === "untouched_leads")!;
    expect(pulse.why).toContain("Diplov +3, Nikhil +3, Kamana +2, Gautam +2");
    const action = home.actions[0] as Extract<NeedsAction, { type: "assign" }>;
    const given = new Map(sliceAssignments(action.leadIds, action.assignments).flatMap((x) => x.ids.map((id) => [id, x.userId] as const)));
    expect(burst.every((u, i) => given.get(`b${i}`) === u)).toBe(true);
  });
});

describe("the Home loader no longer plans for lead-caller only", () => {
  it("load-manager.ts takes its suggestion from the engine, not from planReassign('lead-caller')", () => {
    const src = readFileSync(new URL("../../server/load-manager.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/lead-caller/);
    expect(src).not.toMatch(/planReassign/);
    expect(src).toMatch(/suggestForLeads/);
  });
});

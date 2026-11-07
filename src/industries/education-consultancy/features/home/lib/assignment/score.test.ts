import { describe, expect, it } from "vitest";
import { decideAssignment, smoothedRate, speedScore, type Candidate, type Team } from "./score";
import { deriveLeadSignals } from "./signals";
import { WEIGHTS } from "./weights";

const cand = (id: string, o: Partial<Candidate> = {}): Candidate => ({
  userId: id,
  name: id[0].toUpperCase() + id.slice(1),
  positionKey: "lead-caller",
  branchId: "ktm",
  active: true,
  onLeave: false,
  flag7d: "green",
  heldOpen: 20,
  receivedToday: 0,
  overall: { received: 100, progressed: 30, speedN: 20, medianFirstContactMin: 30 },
  byDestination: {},
  present: true,
  ...o,
});

const team = (o: Partial<Team> = {}): Team => ({
  byDestination: { Australia: { received: 200, progressed: 62 } },
  overall: { received: 1000, progressed: 300 },
  medianFirstContactMin: 40,
  ...o,
});

const lead = (destinations: string[] = [], branchId: string | null = null) => ({ destinations, branchId });

describe("deriveLeadSignals (the Part B seam)", () => {
  it("normalises destinations and branch; nothing else leaks to the scorer", () => {
    expect(deriveLeadSignals({ destinations: [" Australia ", ""], branch_id: "b" })).toEqual({ destinations: ["Australia"], branchId: "b" });
    expect(deriveLeadSignals({ destinations: null, branch_id: null })).toEqual({ destinations: [], branchId: null });
  });
});

describe("Fit", () => {
  it("destination-aware: the person with the best Australia record wins, and the why says so with numbers", () => {
    const asha = cand("asha", { byDestination: { Australia: { received: 60, progressed: 25 } } }); // 42%
    const bina = cand("bina", { byDestination: { Australia: { received: 60, progressed: 12 } } }); // 20%
    const d = decideAssignment(lead(["Australia"]), [bina, asha], team());
    expect(d.pickedUserId).toBe("asha");
    expect(d.why).toMatch(/^Asha: best Australia record \(\d+% vs team 31%\)/);
  });
  it("no destination: Fit is overall progress and the why-line never claims a destination", () => {
    const asha = cand("asha", { overall: { received: 100, progressed: 40, speedN: 20, medianFirstContactMin: 30 } });
    const bina = cand("bina", { overall: { received: 100, progressed: 20, speedN: 20, medianFirstContactMin: 30 } });
    const d = decideAssignment(lead([]), [bina, asha], team());
    expect(d.pickedUserId).toBe("asha");
    expect(d.why).toContain("overall record");
    expect(d.why).not.toMatch(/Australia|UK|destination/);
    expect(d.candidates[0].fit.basis).toBe("overall");
  });
  it("a destination nobody on the team has history for falls back to overall (not a made-up destination record)", () => {
    const d = decideAssignment(lead(["Iceland"]), [cand("asha")], team());
    expect(d.candidates[0].fit.basis).toBe("overall");
    expect(d.why).not.toContain("Iceland");
  });
  it("sparse data is smoothed toward the team rate: 3 of 3 does not look like a 100% closer", () => {
    expect(smoothedRate(3, 3, 0.3)).toBeCloseTo((3 + 10 * 0.3) / 13, 5);
    expect(smoothedRate(3, 3, 0.3)).toBeLessThan(0.5);
    expect(smoothedRate(0, 0, 0.3)).toBeCloseTo(0.3, 5);
  });
  it("a newcomer with no history is not penalised below the team rate", () => {
    const newbie = cand("newbie", { overall: { received: 0, progressed: 0, speedN: 0, medianFirstContactMin: null } });
    const d = decideAssignment(lead([]), [newbie], team());
    expect(d.candidates[0].fit.rate).toBeCloseTo(0.3, 5);
  });
});

describe("Room", () => {
  it("fewer open leads scores higher; clamped at 0 when over 1.5x the role median", () => {
    const light = cand("light", { heldOpen: 10 });
    const mid = cand("mid", { heldOpen: 20 });
    const heavy = cand("heavy", { heldOpen: 60 });
    const d = decideAssignment(lead(), [light, mid, heavy], team());
    const by = Object.fromEntries(d.candidates.map((c) => [c.userId, c.room.score]));
    expect(by.light).toBeGreaterThan(by.mid);
    expect(by.heavy).toBe(0);
    expect(d.candidates.find((c) => c.userId === "mid")!.room.roleMedian).toBe(20);
  });
});

describe("Speed", () => {
  it("<=30 min is full marks, >=24 h is zero, linear between", () => {
    expect(speedScore(10)).toBe(1);
    expect(speedScore(30)).toBe(1);
    expect(speedScore(24 * 60)).toBe(0);
    expect(speedScore(30 + (24 * 60 - 30) / 2)).toBeCloseTo(0.5, 5);
  });
  it("a person with fewer than 5 samples uses the team median, and says so", () => {
    const d = decideAssignment(lead(), [cand("asha", { overall: { received: 100, progressed: 30, speedN: 2, medianFirstContactMin: 1 } })], team({ medianFirstContactMin: 100 }));
    expect(d.candidates[0].speed.source).toBe("team");
    expect(d.candidates[0].speed.minutes).toBe(100);
  });
  it("no data anywhere is neutral, not zero", () => {
    const d = decideAssignment(lead(), [cand("asha", { overall: { received: 0, progressed: 0, speedN: 0, medianFirstContactMin: null } })], team({ medianFirstContactMin: null }));
    expect(d.candidates[0].speed.score).toBe(WEIGHTS.speed * 0.5);
  });
});

describe("Present", () => {
  it("present adds the full weight", () => {
    const d = decideAssignment(lead(), [cand("a", { present: true }), cand("b", { present: false })], team());
    const s = Object.fromEntries(d.candidates.map((c) => [c.userId, c.present.score]));
    expect(s).toEqual({ a: WEIGHTS.present, b: 0 });
  });
});

describe("hard filters", () => {
  it("excludes inactive, on leave, other branch and Pulse-flagged (red/amber) people", () => {
    const pool = [cand("ok"), cand("susp", { active: false }), cand("leave", { onLeave: true }), cand("far", { branchId: "pkr" }), cand("red", { flag7d: "red" }), cand("amber", { flag7d: "amber" })];
    const d = decideAssignment(lead([], "ktm"), pool, team());
    expect(d.pickedUserId).toBe("ok");
    expect(Object.fromEntries(d.candidates.map((c) => [c.userId, c.excluded]))).toEqual({ ok: null, susp: "inactive", leave: "on_leave", far: "other_branch", red: "flagged", amber: "flagged" });
  });
  it("a lead with no branch can go to anyone's branch", () => {
    expect(decideAssignment(lead([], null), [cand("far", { branchId: "pkr" })], team()).pickedUserId).toBe("far");
  });
  it("the cap: over their fair share of today's leads +50% is out", () => {
    // 3 people, 6 assigned today, fair share (6+1)/3 = 2.33, cap = ceil(3.5) = 4.
    const pool = [cand("a", { receivedToday: 4 }), cand("b", { receivedToday: 1 }), cand("c", { receivedToday: 1 })];
    const d = decideAssignment(lead(), pool, team());
    expect(d.candidates.find((c) => c.userId === "a")!.excluded).toBe("at_cap");
    expect(d.pickedUserId).not.toBe("a");
  });
  it("nobody passes (all on leave): fall back to the best by Fit + Room and say they will be called when they start", () => {
    const pool = [cand("a", { onLeave: true, heldOpen: 5 }), cand("b", { onLeave: true, heldOpen: 40 })];
    const d = decideAssignment(lead(), pool, team());
    expect(d.fallback).toBe(true);
    expect(d.pickedUserId).toBe("a");
    expect(d.why).toMatch(/will be called when they start$/);
  });
  it("only suspended people, or an empty pool: no pick", () => {
    expect(decideAssignment(lead(), [cand("x", { active: false })], team()).pickedUserId).toBeNull();
    expect(decideAssignment(lead(), [], team()).pickedUserId).toBeNull();
  });
});

describe("ties and determinism", () => {
  it("identical people: fewest leads received today wins, then name", () => {
    const d = decideAssignment(lead(), [cand("zed", { receivedToday: 1 }), cand("amy", { receivedToday: 2 }), cand("bob", { receivedToday: 1 })], team());
    expect(d.pickedUserId).toBe("bob");
  });
  it("same input, same output regardless of input order", () => {
    const pool = [cand("a"), cand("b"), cand("c")];
    expect(decideAssignment(lead(), [...pool].reverse(), team()).pickedUserId).toBe(decideAssignment(lead(), pool, team()).pickedUserId);
  });
});

describe("the why line", () => {
  it("top two factors with numbers", () => {
    const noSpeed = { received: 100, progressed: 30, speedN: 0, medianFirstContactMin: null };
    const asha = cand("asha", { heldOpen: 18, present: false, overall: noSpeed, byDestination: { Australia: { received: 60, progressed: 25 } } });
    const bina = cand("bina", { heldOpen: 24, present: false, overall: noSpeed, byDestination: { Australia: { received: 60, progressed: 12 } } });
    const d = decideAssignment(lead(["Australia"]), [asha, bina], team());
    expect(d.why).toMatch(/^Asha: best Australia record \(\d+% vs team 31%\) · 18 open leads \(team median 21\)$/);
  });
  it("names speed only when it is the person's own measured speed and one of the top two", () => {
    const asha = cand("asha", { heldOpen: 60 }); // room = 0, so speed (full marks) and fit lead
    const d = decideAssignment(lead(), [asha], team());
    expect(d.why).toBe("Asha: overall record (30% vs team 30%) \u00B7 first contact in 30 min (team 40 min)".replace("overall record", "best overall record"));
  });
  it("stores every candidate with each factor so the decision is auditable", () => {
    const d = decideAssignment(lead(), [cand("a"), cand("b")], team());
    expect(d.candidates).toHaveLength(2);
    for (const c of d.candidates) expect(Object.keys(c)).toEqual(expect.arrayContaining(["fit", "room", "speed", "present", "total", "excluded"]));
  });
});

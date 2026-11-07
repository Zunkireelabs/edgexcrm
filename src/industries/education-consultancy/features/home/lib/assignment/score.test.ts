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
  dormant: false,
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
  it("excludes inactive, on leave, dormant, other branch and Pulse-flagged (red/amber) people", () => {
    const pool = [cand("ok"), cand("susp", { active: false }), cand("leave", { onLeave: true }), cand("idle", { dormant: true }), cand("far", { branchId: "pkr" }), cand("red", { flag7d: "red" }), cand("amber", { flag7d: "amber" })];
    const d = decideAssignment(lead([], "ktm"), pool, team());
    expect(d.pickedUserId).toBe("ok");
    expect(Object.fromEntries(d.candidates.map((c) => [c.userId, c.excluded]))).toEqual({ ok: null, susp: "inactive", leave: "on_leave", idle: "dormant", far: "other_branch", red: "flagged", amber: "flagged" });
  });
  it("a branch with nobody active in the pool is not a filter (Admizz 'Global'): anyone can take it, and the decision says so", () => {
    const pool = [cand("ktm1", { branchId: "ktm" }), cand("pkr1", { branchId: "pkr" })];
    const d = decideAssignment(lead([], "global"), pool, team());
    expect(d.branch).toBe("unstaffed");
    expect(d.candidates.every((c) => c.excluded === null)).toBe(true);
  });
  it("a staffed branch still filters; a suspended person does not make a branch staffed", () => {
    const staffed = decideAssignment(lead([], "ktm"), [cand("a", { branchId: "ktm" }), cand("b", { branchId: "pkr" })], team());
    expect(staffed.branch).toBe("staffed");
    expect(staffed.pickedUserId).toBe("a");
    const onlySuspended = decideAssignment(lead([], "ktm"), [cand("a", { branchId: "ktm", active: false }), cand("b", { branchId: "pkr" })], team());
    expect(onlySuspended.branch).toBe("unstaffed");
    expect(onlySuspended.pickedUserId).toBe("b");
  });
  it("a lead with no branch can go to anyone's branch", () => {
    expect(decideAssignment(lead([], null), [cand("far", { branchId: "pkr" })], team()).branch).toBe("none");
    expect(decideAssignment(lead([], null), [cand("far", { branchId: "pkr" })], team()).pickedUserId).toBe("far");
  });
  it("the cap: over their fair share of today's leads +50% is out", () => {
    // 3 people, 6 assigned today, fair share (6+1)/3 = 2.33, cap = ceil(3.5) = 4.
    const pool = [cand("a", { receivedToday: 4 }), cand("b", { receivedToday: 1 }), cand("c", { receivedToday: 1 })];
    const d = decideAssignment(lead(), pool, team());
    expect(d.candidates.find((c) => c.userId === "a")!.excluded).toBe("at_cap");
    expect(d.pickedUserId).not.toBe("a");
  });
  it("nobody passes (all on leave): NO pick, the lead stays unassigned, and the why says who was out", () => {
    const pool = [cand("a", { onLeave: true, heldOpen: 5 }), cand("b", { onLeave: true, heldOpen: 40 })];
    const d = decideAssignment(lead(), pool, team());
    expect(d.pickedUserId).toBeNull();
    expect(d.why).toBe("No one can take it now (2 on leave), so it stays unassigned for a manager.");
    expect(d.candidates).toHaveLength(2);
    expect(d.candidates.every((c) => c.total === 0 && c.excluded === "on_leave")).toBe(true);
    expect("fallback" in d).toBe(false);
  });
  it("a dormant person (shared mailbox, no activity in 14 days) is never picked, even when they are the only one", () => {
    const d = decideAssignment(lead(), [cand("hello", { dormant: true })], team());
    expect(d.pickedUserId).toBeNull();
    expect(d.why).toContain("1 no activity in 14 days");
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

describe("the why line cites only factors with evidence", () => {
  const thin = { received: 2, progressed: 0, speedN: 1, medianFirstContactMin: 5 };
  it("never prints '0% vs team 0%': a team rate of 0 drops Fit", () => {
    const d = decideAssignment(lead(), [cand("asha")], team({ overall: { received: 0, progressed: 0 }, byDestination: {} }));
    expect(d.why).not.toMatch(/0% vs team 0%/);
    expect(d.why).not.toContain("record");
  });
  it("Fit needs the person's own sample of at least 5 leads", () => {
    const few = decideAssignment(lead(), [cand("asha", { overall: thin })], team());
    expect(few.why).not.toContain("record");
    const enough = decideAssignment(lead(), [cand("asha", { overall: { ...thin, received: 5 } })], team());
    expect(enough.why).toContain("record");
  });
  it("destination-aware Fit counts the destination sample, not the overall one", () => {
    const d = decideAssignment(lead(["Australia"]), [cand("asha", { byDestination: { Australia: { received: 2, progressed: 1 } } })], team());
    expect(d.why).not.toContain("Australia record");
  });
  it("Room needs a real team median of at least 1 (everyone at 0 open leads says nothing about room)", () => {
    const d = decideAssignment(lead(), [cand("asha", { heldOpen: 0, overall: thin, present: false })], team());
    expect(d.why).not.toContain("open leads");
  });
  it("Speed needs the person's own samples (>= 3), not the team's", () => {
    const d = decideAssignment(lead(), [cand("asha", { overall: { received: 100, progressed: 30, speedN: 2, medianFirstContactMin: 5 } })], team());
    expect(d.why).not.toContain("first contact");
  });
  it("no factor has evidence and the pick has strictly the most room: 'most room: N open leads (team median M)'", () => {
    const noEv = { received: 1, progressed: 0, speedN: 0, medianFirstContactMin: null };
    const c = (id: string, held: number) => cand(id, { heldOpen: held, overall: noEv, present: false });
    const d = decideAssignment(lead(), [c("asha", 0), c("bina", 0), c("cara", 2)], team({ overall: { received: 0, progressed: 0 }, byDestination: {}, medianFirstContactMin: null }));
    expect(d.pickedUserId).toBe("asha");
    expect(d.why).toBe("Asha: most room: 0 open leads (team median 0)");
  });
  it("no factor has evidence and room does not decide it: 'fewest new leads today'", () => {
    const noEv = { received: 1, progressed: 0, speedN: 0, medianFirstContactMin: null };
    const d = decideAssignment(lead(), [cand("asha", { heldOpen: 0, overall: noEv, present: false, receivedToday: 0 }), cand("bina", { heldOpen: 0, overall: noEv, present: false, receivedToday: 1 })], team({ overall: { received: 0, progressed: 0 }, byDestination: {}, medianFirstContactMin: null }));
    expect(d.why).toBe("Asha: fewest new leads today");
  });
  it("Room is cited only when the pick holds FEWER open leads than the team median: '129 open leads (team median 129)' is not evidence", () => {
    const ev = { received: 100, progressed: 30, speedN: 0, medianFirstContactMin: null };
    const same = decideAssignment(lead(), [cand("asha", { heldOpen: 129, overall: ev, present: false })], team());
    expect(same.why).not.toContain("open leads (team median");
    const fewer = decideAssignment(lead(), [cand("asha", { heldOpen: 10, overall: ev, present: false }), cand("bina", { heldOpen: 30, overall: ev, present: false })], team());
    expect(fewer.why).toContain("10 open leads (team median 20)");
  });
});

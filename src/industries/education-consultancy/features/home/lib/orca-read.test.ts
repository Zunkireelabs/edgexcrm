import { describe, expect, it } from "vitest";
import { ASK_CHIPS, counsellorFacts, managerFacts, madeAtLabel, READ_MAX_REFRESHES, refreshesLeft, validatePoints, type Fact } from "./orca-read";
import type { DoNextItem } from "./types";
import type { NeedsYouRow } from "./needs-you";

const F = (id: string, text: string, href: string | null = null, linkLabel: string | null = null): Fact => ({ id, text, href, linkLabel });
const FACTS = [
  F("item:a", "Sujan Rai (new lead not yet called): 38 min", "/leads/a", "Open →"),
  F("item:b", "Mina KC (reply waiting): 2 days", "/leads/b", "Open →"),
  F("kind:new_uncalled", "2 new lead not yet calleds on your Do next list"),
  F("look:u1", "Asha: 1 vs usual 31 calls, notes and stage moves (On leave · expected)", "/pulse", "Open in Pulse →"),
];

describe("validatePoints: the number check", () => {
  it("drops a point whose number is in none of the facts (an invented '14 leads')", () => {
    const r = validatePoints([{ claim: "You have 14 leads waiting", reason: "Two are new", factIds: ["kind:new_uncalled"] }], FACTS);
    expect(r).toEqual([]);
  });
  it("keeps a point whose numbers are all in the facts", () => {
    const r = validatePoints([{ claim: "Call Sujan Rai first", reason: "He has waited 38 min", factIds: ["item:a"] }], FACTS);
    expect(r).toHaveLength(1);
    expect(r[0].claim).toBe("Call Sujan Rai first");
  });
  it("counts decimals and commas as the same number, but 3.5 is not 35", () => {
    const facts = [F("w", "calls: 3,5 per day")];
    expect(validatePoints([{ claim: "3.5 a day", reason: "ok", factIds: ["w"] }], facts)).toHaveLength(1);
    expect(validatePoints([{ claim: "35 a day", reason: "ok", factIds: ["w"] }], facts)).toHaveLength(0);
  });
  it("drops a point that cites an id it was not given (even alongside a good one)", () => {
    expect(validatePoints([{ claim: "x", reason: "y", factIds: ["item:ZZZ"] }], FACTS)).toEqual([]);
    expect(validatePoints([{ claim: "x", reason: "y", factIds: ["item:a", "item:ZZZ"] }], FACTS)).toEqual([]);
  });
  it("keeps at most 3 points", () => {
    const pts = Array.from({ length: 5 }, (_, i) => ({ claim: `point ${i === 0 ? "" : "x"}`.trim() || "p", reason: "r", factIds: ["item:a"] }));
    expect(validatePoints(pts, FACTS)).toHaveLength(3);
  });
  it("nothing worth saying gives an empty list (the card does not show)", () => {
    expect(validatePoints([], FACTS)).toEqual([]);
  });
});

describe("validatePoints: links come from ids, never from the model", () => {
  it("the link is the first cited fact's href and label, built by us", () => {
    const [p] = validatePoints([{ claim: "Call Sujan Rai", reason: "waiting", factIds: ["item:a"] }], FACTS);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open →" });
  });
  it("several cited rows say so", () => {
    const [p] = validatePoints([{ claim: "Two people are waiting", reason: "Sujan Rai and Mina KC", factIds: ["item:a", "item:b"] }], FACTS);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open first of 2 →" });
  });
  it("a Pulse fact opens Pulse; a fact with no href gives no link", () => {
    expect(validatePoints([{ claim: "Asha is away", reason: "On leave", factIds: ["look:u1"] }], FACTS)[0].link).toEqual({ href: "/pulse", label: "Open in Pulse →" });
    expect(validatePoints([{ claim: "Two are new", reason: "count", factIds: ["kind:new_uncalled"] }], FACTS)[0].link).toBeNull();
  });
});

const item = (o: Partial<DoNextItem>): DoNextItem => ({
  key: "k", kind: "new_uncalled", tier: "now", title: "Sujan Rai", why: "Australia", chip: { text: "38 min", tone: "new" }, tone: "new",
  primaryAction: { type: "call", leadId: "a", phone: "9841234567", leadName: "Sujan Rai" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads/a", ...o,
});

describe("counsellorFacts: only the person's own data", () => {
  it("builds facts from exactly the items given: no other person's lead can appear", () => {
    const facts = counsellorFacts([item({ key: "new_uncalled:a", title: "Sujan Rai" })], []);
    const text = facts.map((f) => f.text).join("\n");
    expect(text).toContain("Sujan Rai");
    expect(text).not.toContain("Someone Else");
    expect(facts.find((f) => f.id === "item:new_uncalled:a")?.href).toBe("/leads/a");
  });
  it("never carries a phone number (the call action's phone is not a fact)", () => {
    const facts = counsellorFacts([item({})], []);
    expect(JSON.stringify(facts)).not.toContain("9841234567");
  });
  it("week numbers are facts without links", () => {
    const f = counsellorFacts([], [{ key: "calls", label: "calls", value: "46", note: "usual 52", tone: "neutral" }]);
    expect(f).toEqual([{ id: "week:calls", text: "This week, calls: 46 (usual 52)", href: null, linkLabel: null }]);
  });
});

describe("managerFacts", () => {
  const row: NeedsYouRow = { key: "assign", tone: "warn", icon: "user-plus", title: "5 new leads unassigned", chip: { text: "5", tone: "warn" }, why: "waiting since 9am", actions: [{ type: "link", label: "Review", href: "/leads?x=1" }] };
  it("a Needs you row links to its own Review href; a person on leave carries 'expected'", () => {
    const f = managerFacts([row], { rows: [{ userId: "u1", name: "Asha", initials: "A", sub: "On leave · expected", value: "1 vs usual 31", unit: "calls, notes and stage moves", tone: "muted" }], others: 11 }, [], true);
    expect(f.find((x) => x.id === "need:assign")?.href).toBe("/leads?x=1");
    expect(f.find((x) => x.id === "look:u1")?.text).toContain("On leave · expected");
    expect(f.find((x) => x.id === "look:others")?.text).toBe("11 other people are on track");
  });
  it("a branch manager (no Pulse) gets no Pulse link", () => {
    const f = managerFacts([], { rows: [{ userId: "u1", name: "Asha", initials: "A", sub: "", value: "1", unit: "new leads", tone: "warn" }], others: 0 }, [], false);
    expect(f[0].href).toBeNull();
  });
});

describe("small helpers", () => {
  it("3 refreshes a day, then none left", () => {
    expect(READ_MAX_REFRESHES).toBe(3);
    expect([0, 1, 2, 3, 4].map(refreshesLeft)).toEqual([3, 2, 1, 0, 0]);
  });
  it("the header says the real time it was made", () => {
    expect(madeAtLabel(new Date("2026-11-09T01:15:00.000Z"), "Asia/Kathmandu")).toBe("made at 7:00 am");
    expect(madeAtLabel(new Date("2026-11-09T03:29:00.000Z"), "Asia/Kathmandu")).toBe("made at 9:14 am");
  });
  it("two ask chips per role", () => {
    expect(ASK_CHIPS.me).toHaveLength(2);
    expect(ASK_CHIPS.business).toHaveLength(2);
  });
});

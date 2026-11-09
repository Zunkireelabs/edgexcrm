import { describe, expect, it } from "vitest";
import { ASK_CHIPS, counsellorFacts, managerFacts, madeAtLabel, READ_MAX_REFRESHES, refreshesLeft, validatePoints, type Fact } from "./orca-read";
import type { DoNextItem } from "./types";
import type { NeedsYouRow } from "./needs-you";

const F = (id: string, text: string, href: string, linkLabel = "Open →"): Fact => ({ id, text, href, linkLabel });
const FACTS = [
  F("item:a", "Sujan Rai (new lead not yet called): 38 min", "/leads/a"),
  F("item:b", "Mina KC (reply waiting): 2 days", "/leads/b"),
  F("kind:new_uncalled", "2 new lead not yet calleds on your Do next list", "/home#do-next", "Open 2 →"),
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
    const facts = [F("w", "calls: 3,5 per day", "/home#week")];
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
  it("a Pulse fact opens Pulse", () => {
    expect(validatePoints([{ claim: "Asha is away", reason: "On leave", factIds: ["look:u1"] }], FACTS)[0].link).toEqual({ href: "/pulse", label: "Open in Pulse →" });
  });
  it("R2: a point whose cited facts have no link is DROPPED, not shown bare", () => {
    const noLink = [{ id: "x", text: "551 reminders", href: "", linkLabel: "" }];
    expect(validatePoints([{ claim: "Clear the 551 reminders", reason: "old", factIds: ["x"] }], noLink)).toEqual([]);
  });
});

const item = (o: Partial<DoNextItem>): DoNextItem => ({
  key: "k", kind: "new_uncalled", tier: "now", title: "Sujan Rai", why: "Australia", chip: { text: "38 min", tone: "new" }, tone: "new",
  primaryAction: { type: "call", leadId: "a", phone: "9841234567", leadName: "Sujan Rai" }, sortKey: { group: 0, at: 0 }, evidenceHref: "/leads/a", ...o,
});

describe("counsellorFacts: only the person's own data, every fact linked", () => {
  it("builds facts from exactly the items given: no other person's lead can appear", () => {
    const facts = counsellorFacts([item({ key: "new_uncalled:a", title: "Sujan Rai" })], []);
    const text = facts.map((f) => f.text).join("\n");
    expect(text).toContain("Sujan Rai");
    expect(text).not.toContain("Someone Else");
    expect(facts.find((f) => f.id === "item:new_uncalled:a")?.href).toBe("/leads/a");
  });
  it("never carries a phone number (the call action's phone is not a fact)", () => {
    expect(JSON.stringify(counsellorFacts([item({})], []))).not.toContain("9841234567");
  });
  it("R1: a grouped row opens ITS OWN sheet on Home, never a bare /leads; the label says how many", () => {
    const child = item({ key: "callback_overdue:z" });
    const grouped = item({ key: "missed_callbacks:all", kind: "missed_callbacks", title: "52 missed call-backs", evidenceHref: "/leads", primaryAction: { type: "sheet", label: "Call through them" }, children: Array.from({ length: 52 }, () => child) });
    const quiet = item({ key: "going_quiet:all", kind: "going_quiet", title: "22 leads going quiet", evidenceHref: "/leads", primaryAction: { type: "sheet", label: "Open 22" }, children: Array.from({ length: 22 }, () => child) });
    const facts = counsellorFacts([grouped, quiet, item({})], [{ key: "calls", label: "calls", value: "46", note: null, tone: "neutral" }]);
    expect(facts.find((f) => f.id === "item:missed_callbacks:all")).toMatchObject({ href: "/home?open=missed_callbacks%3Aall", linkLabel: "Open 52 →" });
    expect(facts.find((f) => f.id === "item:going_quiet:all")).toMatchObject({ href: "/home?open=going_quiet%3Aall", linkLabel: "Open 22 →" });
    // no fact at all points at a bare /leads
    expect(facts.filter((f) => f.href === "/leads")).toEqual([]);
    expect(facts.every((f) => f.href && f.linkLabel)).toBe(true);
  });
  it("R5: a grouped row states its own lead count, and gets no per-kind 'the 1 on your list' fact", () => {
    const child = item({ key: "callback_overdue:z" });
    const grouped = item({ key: "missed_callbacks:all", kind: "missed_callbacks", title: "59 missed call-backs", evidenceHref: "/leads", primaryAction: { type: "sheet", label: "x" }, children: Array.from({ length: 59 }, () => child) });
    const facts = counsellorFacts([grouped], []);
    expect(facts.some((f) => f.id.startsWith("kind:"))).toBe(false);
    expect(facts[0].text).toContain("59 leads");
  });
  it("R5: per-kind counts only for 2+ separate rows, linked to the Do next list", () => {
    const facts = counsellorFacts([item({ key: "new_uncalled:a" }), item({ key: "new_uncalled:b" }), item({ key: "reply_waiting:c", kind: "reply_waiting" })], []);
    expect(facts.find((f) => f.id === "kind:new_uncalled")).toMatchObject({ href: "/home#do-next", linkLabel: "Open 2 →" });
    expect(facts.find((f) => f.id === "kind:reply_waiting")).toBeUndefined();
  });
  it("R2/R5: week numbers link to the 'Your last 7 days' card and say 'in the last 7 days'", () => {
    const [f] = counsellorFacts([], [{ key: "calls", label: "calls", value: "46", note: "usual 52", tone: "neutral" }]);
    expect(f).toEqual({ id: "week:calls", text: "In the last 7 days, calls: 46 (usual 52)", href: "/home#week", linkLabel: "See why →" });
    expect(f.text).not.toMatch(/this week/i);
  });
  it("R5: a rate under 5 events ('0 of 1') is not a fact; 'of 15' is", () => {
    const facts = counsellorFacts([], [
      { key: "first_hour", label: "New leads called within 1 working hour", value: "0 of 1", note: "usual 1 of 15", tone: "neutral" },
      { key: "moves", label: "Leads called in time", value: "9 of 15", note: null, tone: "neutral" },
    ]);
    expect(facts.map((f) => f.id)).toEqual(["week:moves"]);
  });
});

describe("managerFacts: every fact linked", () => {
  const row = (o: Partial<NeedsYouRow>): NeedsYouRow => ({ key: "assign", tone: "warn", icon: "user-plus", title: "5 new leads unassigned", chip: { text: "5", tone: "warn" }, why: "waiting since 9am", actions: [{ type: "link", label: "Review", href: "/leads?x=1" }], ...o });
  const look = { rows: [{ userId: "u1", name: "Asha", initials: "A", sub: "On leave · expected", value: "1 vs usual 31", unit: "calls, notes and stage moves", tone: "muted" as const }], others: 11 };
  const pl = (id: string) => `/leads?assignee=${id}`;
  it("a row's own link, else the row itself on Home; an assign row says 'Assign N →'", () => {
    const f = managerFacts(
      [row({}), row({ key: "stale", actions: [{ type: "clear_stale", label: "Clear", count: 551 }] }), row({ key: "auto", actions: [{ type: "assign", label: "Assign 7", leadIds: ["a", "b", "c", "d", "e", "f", "g"], assignments: [] }] })],
      look, [], true, pl,
    );
    expect(f.find((x) => x.id === "need:assign")).toMatchObject({ href: "/leads?x=1", linkLabel: "Open →" });
    expect(f.find((x) => x.id === "need:stale")).toMatchObject({ href: "/home#need-stale", linkLabel: "See why →" });
    expect(f.find((x) => x.id === "need:auto")).toMatchObject({ href: "/home#need-auto", linkLabel: "Assign 7 →" });
    expect(f.every((x) => x.href && x.linkLabel)).toBe(true);
  });
  it("a person: owner opens Pulse; a branch manager sees their leads", () => {
    expect(managerFacts([], look, [], true, pl).find((x) => x.id === "look:u1")).toMatchObject({ href: "/pulse", linkLabel: "Open in Pulse →" });
    expect(managerFacts([], look, [], false, pl).find((x) => x.id === "look:u1")).toMatchObject({ href: "/leads?assignee=u1", linkLabel: "See their leads →" });
  });
  it("a person on leave carries 'expected'", () => {
    expect(managerFacts([], look, [], true, pl).find((x) => x.id === "look:u1")?.text).toContain("On leave · expected");
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

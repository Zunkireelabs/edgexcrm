import { describe, expect, it } from "vitest";
import { ASK_CHIPS, counsellorFacts, fillerFlaws, linkWords, managerFacts, madeAtLabel, pluralFlaws, READ_MAX_REFRESHES, refreshesLeft, validatePoints, type Fact } from "./orca-read";
import type { DoNextItem } from "./types";
import type { NeedsYouRow } from "./needs-you";

const F = (id: string, text: string, href: string, linkLabel = "Open →"): Fact => ({ id, text, href, linkLabel });
const FACTS = [
  F("item:a", "Sujan Rai (new lead not yet called): 38 min", "/leads/a"),
  F("item:b", "Mina KC (reply waiting): 2 days", "/leads/b"),
  F("kind:new_uncalled", "2 new lead not yet calleds on your Do next list", "/home#do-next", "Open 2 →"),
  F("look:u1", "Asha: 1 vs usual 31 calls, notes and stage moves (On leave · expected)", "/pulse", "Open in Pulse →"),
  // Not a row on Home: a week number. A point that also cites it adds something the rows do not show (F4a).
  F("week:calls", "In the last 7 days, calls: 12", "/home#week", "See why →"),
  F("kind:overdue", "call-back overdue: 5", "/home#do-next", "Open 5 →"),
];

describe("validatePoints: the number check", () => {
  it("drops a point whose number is in none of the facts (an invented '14 leads')", () => {
    const r = validatePoints([{ claim: "You have 14 leads waiting", reason: "Two are new", factIds: ["kind:new_uncalled"] }], FACTS);
    expect(r).toEqual([]);
  });
  it("keeps a point whose numbers are all in the facts", () => {
    const r = validatePoints([{ claim: "Call Sujan Rai first", reason: "You have 2 new leads uncalled", factIds: ["item:a", "kind:new_uncalled"] }], FACTS);
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
    const pts = Array.from({ length: 5 }, (_, i) => ({ claim: `point ${i === 0 ? "" : "x"}`.trim() || "p", reason: "2 are waiting", factIds: ["item:a", "kind:new_uncalled"] }));
    expect(validatePoints(pts, FACTS)).toHaveLength(3);
  });
  it("nothing worth saying gives an empty list (the card does not show)", () => {
    expect(validatePoints([], FACTS)).toEqual([]);
  });
});

describe("F4: a point must add to the rows Home already shows", () => {
  it("(a) a point about only rows, with no number the rows don't carry, is dropped", () => {
    expect(validatePoints([{ claim: "Sujan Rai has waited 38 min", reason: "Mina KC has waited 2 days", factIds: ["item:a", "item:b"] }], FACTS)).toEqual([]);
    expect(validatePoints([{ claim: "Sujan Rai is waiting", reason: "A new lead", factIds: ["item:a"] }], FACTS)).toEqual([]);
  });
  it("(a) a point that also cites a non-row fact, or carries a number the row doesn't show, stays", () => {
    expect(validatePoints([{ claim: "Sujan Rai is waiting", reason: "You have 2 new leads uncalled", factIds: ["item:a", "kind:new_uncalled"] }], FACTS)).toHaveLength(1);
    // B9: a number only the side card shows, or no number at all, is not new
    expect(validatePoints([{ claim: "Sujan Rai is waiting", reason: "Your 12 calls this week left no time", factIds: ["item:a", "week:calls"] }], FACTS)).toEqual([]);
    expect(validatePoints([{ claim: "Sujan Rai is waiting", reason: "A usual busy day", factIds: ["item:a", "kind:new_uncalled"] }], FACTS)).toEqual([]);
  });
  it("(b) 'not contacted any' is dropped unless a cited fact says none, with the same number", () => {
    const facts = [F("need:k", "Kamana: 1 day since the last call", "/home#need-k"), F("impact:c", "Calls: 0 today, 3 days ago 14", "/home#impact"), F("week:x", "In the last 7 days, calls: 12", "/home#week")];
    expect(validatePoints([{ claim: "Kamana has not contacted any leads for over 3 days", reason: "Calls dropped", factIds: ["need:k", "week:x"] }], facts)).toEqual([]);
    expect(validatePoints([{ claim: "No calls today", reason: "Down from 14", factIds: ["impact:c"] }], facts)).toHaveLength(1);
  });
});

describe("B9: filler and repeats of Home", () => {
  const FACTS9 = [
    F("item:s", "Sushil Sunar (lead who has not picked up): 3 unanswered calls", "/leads/s"),
    F("item:p", "Parash Kunwar (lead who has not picked up): 3 unanswered calls", "/leads/p"),
    F("week:calls", "In the last 7 days, calls made: 0 (usual 33)", "/home#week", "See why →"),
    F("kind:callback_overdue", "call-back overdue: 4", "/home#do-next", "Open 4 →"),
  ];
  it("real failure 1: two rows restated with 'unusual compared to the usual' is dropped", () => {
    expect(validatePoints([{ claim: "You have 2 leads who have not picked up.", reason: "Sushil Sunar and Parash Kunwar each have 3 unanswered calls, which is unusual compared to the usual activity.", factIds: ["item:s", "item:p", "week:calls"] }], [...FACTS9, F("x", "2 leads", "/h")])).toEqual([]);
  });
  it("real failure 2: the 'Your last 7 days' card restated with 'indicating a significant drop' is dropped", () => {
    expect(validatePoints([{ claim: "There have been 0 calls made in the last 7 days.", reason: "This is well below the usual count of 33 calls, indicating a significant drop in outreach activity.", factIds: ["week:calls"] }], FACTS9)).toEqual([]);
    // even without the filler words, it only repeats the side card
    expect(validatePoints([{ claim: "There have been 0 calls made in the last 7 days.", reason: "The usual count is 33 calls.", factIds: ["week:calls"] }], FACTS9)).toEqual([]);
  });
  it("a point with a real new number (a count across rows that is itself a fact) is kept", () => {
    expect(validatePoints([{ claim: "Clear your 4 overdue call-backs first.", reason: "Sushil Sunar has 3 unanswered calls.", factIds: ["kind:callback_overdue", "item:s"] }], FACTS9)).toHaveLength(1);
  });
  it("a filler word drops the point, and fillerFlaws names the exact words for the retry", () => {
    expect(validatePoints([{ claim: "Clear your 4 overdue call-backs first.", reason: "This is a significant backlog.", factIds: ["kind:callback_overdue"] }], FACTS9)).toEqual([]);
    expect(fillerFlaws("indicating a Significant drop", "outreach activity is limited")).toEqual(["indicating", "significant", "outreach activity", "limited"]);
    expect(fillerFlaws("Clear your 4 overdue call-backs first.")).toEqual([]);
  });
});

describe("validatePoints: links come from ids, never from the model", () => {
  it("the link is the first cited fact's href and label, built by us", () => {
    const [p] = validatePoints([{ claim: "Call Sujan Rai", reason: "2 are waiting", factIds: ["item:a", "kind:new_uncalled"] }], FACTS);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open →" });
  });
  it("several cited rows say so", () => {
    const [p] = validatePoints([{ claim: "Two people are waiting", reason: "Sujan Rai and Mina KC, with 5 call-backs overdue", factIds: ["item:a", "item:b", "kind:overdue"] }], FACTS);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open first of 2 →" });
  });
  it("a Pulse fact opens Pulse", () => {
    expect(validatePoints([{ claim: "Asha is away", reason: "On leave, 2 uncalled", factIds: ["look:u1", "kind:new_uncalled"] }], FACTS)[0].link).toEqual({ href: "/pulse", label: "Open in Pulse →" });
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

describe("S6: the label counts only item facts", () => {
  const facts = [
    { id: "kind:new_uncalled", text: "new lead not yet called: 2", href: "/home#do-next", linkLabel: "Open 2 →" },
    { id: "item:a", text: "Sujan Rai (new lead): 38 min", href: "/leads/a", linkLabel: "Open →" },
    { id: "item:b", text: "Pooja Shrestha (new lead): 40 min", href: "/leads/b", linkLabel: "Open →" },
  ];
  it("a point citing the per-kind fact and 2 leads says 'first of 2', not 3, and links to a lead", () => {
    const [p] = validatePoints([{ claim: "Call the 2 new leads", reason: "Neither has been called.", factIds: ["kind:new_uncalled", "item:a", "item:b"] }], facts);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open first of 2 →" });
  });
  it("a point citing only the per-kind fact and ONE lead is that lead's plain label", () => {
    const [p] = validatePoints([{ claim: "Call Sujan Rai", reason: "You have 2 to call", factIds: ["kind:new_uncalled", "item:a"] }], facts);
    expect(p.link).toEqual({ href: "/leads/a", label: "Open →" });
  });
  it("the per-kind text has no filler about rows or lists", () => {
    const f = counsellorFacts([item({ key: "new_uncalled:a" }), item({ key: "new_uncalled:b" })], []).find((x) => x.id === "kind:new_uncalled");
    expect(f?.text).toBe("new lead not yet called: 2");
    expect(f?.text).not.toMatch(/row|list/i);
  });
});

describe("S7: manager link words come from the row", () => {
  it("'Review 388' reads 'Open 388'; person and Pulse words stay", () => {
    expect(linkWords("Review 388")).toBe("Open 388");
    expect(linkWords("See their leads")).toBe("See their leads");
    expect(linkWords("Open in Pulse")).toBe("Open in Pulse");
    expect(linkWords("  ")).toBe("Open");
  });
  it("a Needs-you row with a 'Review 388' link says 'Open 388 →'", () => {
    const row = { key: "untouched_leads", tone: "warn", icon: "user-plus", title: "388 new leads nobody has contacted", chip: null, why: "x", actions: [{ type: "link", label: "Review 388", href: "/leads?f=1" }] } as unknown as NeedsYouRow;
    const f = managerFacts([row], { rows: [], others: 0 }, [], true, (id) => id).find((x) => x.id === "need:untouched_leads");
    expect(f).toMatchObject({ href: "/leads?f=1", linkLabel: "Open 388 →" });
  });
  it("a person row for a branch manager says 'See their leads →'", () => {
    const row = { key: "drop", tone: "warn", icon: "trend-down", title: "Asha's activity dropped", chip: null, why: "x", actions: [{ type: "link", label: "See their leads", href: "/leads?f=asha" }] } as unknown as NeedsYouRow;
    expect(managerFacts([row], { rows: [], others: 0 }, [], false, (id) => id)[0]).toMatchObject({ linkLabel: "See their leads →" });
  });
});

describe("Q11: wrong counts", () => {
  it("'1 leads', '1 calls', '1 people' are flagged", () => {
    expect(pluralFlaws("Manish is leaving 120, 70 and 1 leads untouched")).toEqual(["1 leads"]);
    expect(pluralFlaws("1 calls was made", "1 people waited", "1 replies")).toEqual(["1 calls", "1 people", "1 replies"]);
  });
  it("'2 lead' and '0 call' are flagged too", () => {
    expect(pluralFlaws("2 lead are waiting", "0 call today")).toEqual(["2 lead", "0 call"]);
  });
  it("right counts and compounds pass", () => {
    expect(pluralFlaws("1 lead, 2 leads, 1 call, 11 calls, 21 leads", "a 3 week plan", "1 hour", "30 days", "1 call-back and 3 call-backs")).toEqual([]);
  });
});

describe("Q9: no first-hour fact when nothing arrived", () => {
  it("a 'No new leads this week' metric is not offered to the model as a fact", () => {
    const facts = counsellorFacts([], [{ key: "first_hour", label: "New leads called within 1 working hour", value: "\u2014", note: "No new leads this week", tone: "neutral" }]);
    expect(facts).toEqual([]);
  });
});

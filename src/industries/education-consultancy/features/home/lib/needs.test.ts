import { describe, expect, it } from "vitest";
import type { AttentionItem, PersonRow } from "../../pulse/lib/types";
import { needsALook } from "./needs-a-look";
import { quietOverRow } from "./needs-you";
import { attentionRows, atRiskRow, sliceAssignments, unassignedRow } from "./needs-you";
import { nudgeState, stillUntouchedCount } from "./nudge";

const TZ = "Asia/Kathmandu";

const attn = (o: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "s1", category: "needs_action", tone: "bad", icon: "down", subject: "Asha Tamang", what: "calls down 45%",
  figure: { strong: "14", text: " leads untouched" }, suggested: true,
  action: { label: "Reassign 14 to Bikash", href: "/leads?f=x", primary: true },
  why: null, meta: null,
  links: [{ label: "See the 14 leads", href: "/leads?f=x" }, { label: "Asha's activity", personId: "asha" }],
  drill: {} as AttentionItem["drill"], ...o,
});

describe("attentionRows (Pulse's own items, top 3)", () => {
  it("keeps Pulse's order and takes the first 3 needs-action items", () => {
    const rows = attentionRows([attn({ id: "a" }), attn({ id: "b" }), attn({ id: "c" }), attn({ id: "d" })], new Map(), "me");
    expect(rows.map((r) => r.key)).toEqual(["attn:a", "attn:b", "attn:c"]);
  });
  it("offers 'Nudge <first name>' then Reassign for a person item", () => {
    const [r] = attentionRows([attn()], new Map(), "me");
    expect(r.actions.map((a) => a.label)).toEqual(["Nudge Asha", "Reassign 14 to Bikash"]);
    expect(r.title).toBe("Asha Tamang");
    expect(r.chip).toEqual({ text: "14 leads untouched", tone: "bad" });
  });
  it("after a nudge today: chip 'Nudged today', no second nudge", () => {
    const [r] = attentionRows([attn()], new Map([["asha", { kind: "today" as const }]]), "me");
    expect(r.chip?.text).toBe("Nudged today");
    expect(r.actions.some((a) => a.type === "nudge")).toBe(false);
  });
  it("next day, still untouched: 'nudged yesterday, still N' with Reassign FIRST", () => {
    const [r] = attentionRows([attn()], new Map([["asha", { kind: "returned" as const, still: 9, when: "yesterday" }]]), "me");
    expect(r.title).toBe("Asha Tamang · nudged yesterday, still 9");
    expect(r.actions[0]).toMatchObject({ type: "link", label: "Reassign 14 to Bikash", primary: true });
  });
});

describe("the viewer is never a Needs-you subject", () => {
  const self = attn({ id: "self", subject: "Bijay Dahal", links: [{ label: "See", href: "/x" }, { label: "Bijay's activity", personId: "bijay" }] });
  it("drops the viewer's own item and never offers 'Nudge <self>'", () => {
    const rows = attentionRows([self, attn({ id: "asha" })], new Map(), "bijay");
    expect(rows.map((r) => r.key)).toEqual(["attn:asha"]);
    expect(rows.flatMap((r) => r.actions).some((a) => a.type === "nudge" && a.userId === "bijay")).toBe(false);
  });
  it("refills the top 3 from the next items instead of leaving a gap", () => {
    const rows = attentionRows([self, attn({ id: "a" }), attn({ id: "b" }), attn({ id: "c" })], new Map(), "bijay");
    expect(rows.map((r) => r.key)).toEqual(["attn:a", "attn:b", "attn:c"]);
  });
  it("an item the viewer is NOT the subject of is untouched, and non-person items stay", () => {
    expect(attentionRows([self], new Map(), "someone-else")).toHaveLength(1);
    const team = attn({ id: "team", icon: "clock", subject: "6 new leads", links: [{ label: "See", href: "/y" }], action: null });
    expect(attentionRows([team], new Map(), "bijay")).toHaveLength(1);
  });
  it("the nudge API refuses a self-nudge (canNudge)", () => {
    expect(canNudge({ restrictToSelf: false, selfId: "bijay", targetId: "bijay", branchPinned: false, branchMemberIds: ["bijay"] })).toBe(false);
  });
});

describe("nudgeState", () => {
  const now = new Date("2026-11-10T05:00:00.000Z"); // Tue 10:45 Kathmandu
  it("resolved when nothing is still untouched, or stamped resolved", () => {
    expect(nudgeState({ createdAt: "2026-11-09T05:00:00.000Z", resolvedAt: null }, 0, now, TZ)).toEqual({ kind: "resolved" });
    expect(nudgeState({ createdAt: "2026-11-09T05:00:00.000Z", resolvedAt: "2026-11-09T09:00:00.000Z" }, 4, now, TZ)).toEqual({ kind: "resolved" });
  });
  it("same tenant-local day → today (23:00 UTC Monday is already Tuesday in Kathmandu)", () => {
    expect(nudgeState({ createdAt: "2026-11-09T23:00:00.000Z", resolvedAt: null }, 3, now, TZ)).toEqual({ kind: "today" });
    expect(nudgeState({ createdAt: "2026-11-09T23:00:00.000Z", resolvedAt: null }, 3, now, "UTC")).toEqual({ kind: "returned", still: 3, when: "yesterday" });
  });
  it("an earlier day → returned, 'yesterday' or the weekday", () => {
    expect(nudgeState({ createdAt: "2026-11-09T05:00:00.000Z", resolvedAt: null }, 3, now, TZ)).toEqual({ kind: "returned", still: 3, when: "yesterday" });
    expect(nudgeState({ createdAt: "2026-11-06T05:00:00.000Z", resolvedAt: null }, 3, now, TZ)).toEqual({ kind: "returned", still: 3, when: "Fri" });
  });
  it("counts leads untouched since the nudge", () => {
    expect(stillUntouchedCount([{ id: "a", lastTouchedAt: null }, { id: "b", lastTouchedAt: "2026-11-08T00:00:00.000Z" }, { id: "c", lastTouchedAt: "2026-11-10T00:00:00.000Z" }], "2026-11-09T00:00:00.000Z")).toBe(2);
  });
});

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  userId: "u", name: "Asha Tamang", positionLabel: "TeleCaller", branchName: "Kathmandu", flag: null, hasUsual: true,
  current: { calls: 21, notes: 0, moves: 0, received: 30 }, usual: { calls: 38.4, notes: 0, moves: 0, received: 10 }, ...o,
}) as unknown as PersonRow;

describe("needsALook", () => {
  it("lists only red/amber people, red first, never the viewer, and counts the rest", () => {
    const r = needsALook(
      [person({ userId: "me", flag: "red" }), person({ userId: "a", name: "Asha", flag: "red" }), person({ userId: "b", name: "Bina", flag: "amber" }), person({ userId: "c", name: "Chirag" }), person({ userId: "d", name: "Dev", flag: "green" })],
      new Set(),
      "me",
    );
    // person(): calls 21 / usual 38.4, received 30 / usual 10; the drop is measured on activity (calls + notes + moves)
    expect(r.rows.map((x) => [x.name, x.tone, x.value, x.unit])).toEqual([["Asha", "bad", "21 vs usual 38", "calls, notes and stage moves"], ["Bina", "warn", "30 vs usual 10", "new leads"]]);
    expect(r.others).toBe(2);
  });
  it("uses the SAME measure as Pulse's flag: a person flagged on activity (1 vs usual 31) is not shown as '0 / 0 calls'", () => {
    const r = needsALook([person({ userId: "a", name: "Bijay Dahal", flag: "red", current: { calls: 0, notes: 1, moves: 0, received: 0 }, usual: { calls: 0, notes: 20, moves: 11, received: 0 } } as Partial<PersonRow>)], new Set(), "me");
    expect(r.rows[0].value).toBe("1 vs usual 31");
    expect(r.rows[0].unit).toBe("calls, notes and stage moves");
  });
  it("someone on approved leave is grey, 'On leave · expected', and sorts last", () => {
    const r = needsALook([person({ userId: "a", name: "Asha", flag: "red" }), person({ userId: "r", name: "Rita", flag: "red" })], new Set(["r"]), "me");
    expect(r.rows.map((x) => [x.name, x.tone, x.sub])).toEqual([["Asha", "bad", "TeleCaller · Kathmandu"], ["Rita", "muted", "On leave · expected"]]);
  });
});

describe("unassignedRow", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const p = (id: string, name: string) => ({ userId: id, name }) as unknown as PersonRow;
  it("a split plan offers 'Assign as suggested' (primary) and 'Choose…', and says who gets what", () => {
    const r = unassignedRow({ count: 6, oldestAt: "2026-11-08T22:00:00.000Z", now, plan: { kind: "split", targets: [{ person: p("a", "Asha"), held: 20, take: 3 }, { person: p("c", "Chirag"), held: 22, take: 3 }] }, leadIds: ["1", "2", "3", "4", "5", "6"], chooseHref: "/leads?x" })!;
    expect(r.title).toBe("Assign 6 new leads");
    expect(r.chip?.text).toBe("Waiting 14 h");
    expect(r.why).toBe("Suggested: Asha +3, Chirag +3 · they have the most room");
    expect(r.actions.map((a) => a.label)).toEqual(["Assign as suggested", "Choose…"]);
  });
  it("no capacity → Review, no assign button; too many to assign in one click → only Choose", () => {
    expect(unassignedRow({ count: 4, oldestAt: null, now, plan: { kind: "none" }, leadIds: ["1"], chooseHref: "/l" })!.actions.map((a) => a.label)).toEqual(["Review 4"]);
    expect(unassignedRow({ count: 900, oldestAt: null, now, plan: { kind: "one", target: p("a", "Asha"), held: 2000 }, leadIds: null, chooseHref: "/l" })!.actions.map((a) => a.label)).toEqual(["Choose…"]);
  });
  it("nothing unassigned → no row", () => {
    expect(unassignedRow({ count: 0, oldestAt: null, now, plan: { kind: "none" }, leadIds: [], chooseHref: "/l" })).toBeNull();
  });
  it("sliceAssignments hands the ids out in plan order", () => {
    expect(sliceAssignments(["1", "2", "3", "4", "5"], [{ userId: "a", take: 3 }, { userId: "c", take: 2 }])).toEqual([{ userId: "a", ids: ["1", "2", "3"] }, { userId: "c", ids: ["4", "5"] }]);
  });
});

describe("atRiskRow", () => {
  it("groups applications, naming up to two with their owner", () => {
    const r = atRiskRow([{ id: "1", leadName: "Sita Gurung", assigneeName: "Rita Karki", missingCount: 1 }, { id: "2", leadName: "Arun Basnet", assigneeName: "Asha Tamang", missingCount: 2 }, { id: "3", leadName: "Mina", assigneeName: null, missingCount: 1 }], "/applications")!;
    expect(r.title).toBe("3 applications at risk");
    expect(r.why).toBe("Sita Gurung (Rita) · Arun Basnet (Asha) and 1 more · documents missing on all");
  });
  it("none → null", () => expect(atRiskRow([], "/a")).toBeNull());
});

import { canNudge, managerDisplayName, nudgeMessage } from "./nudge";

describe("canNudge", () => {
  const base = { restrictToSelf: false, selfId: "m", targetId: "t", branchPinned: false, branchMemberIds: [] as string[] };
  it("own-scope people cannot nudge anyone; nobody nudges themselves", () => {
    expect(canNudge({ ...base, restrictToSelf: true })).toBe(false);
    expect(canNudge({ ...base, targetId: "m" })).toBe(false);
  });
  it("an all-scope owner can nudge anyone in the tenant", () => expect(canNudge(base)).toBe(true));
  it("a branch-pinned manager only their own branch's people", () => {
    expect(canNudge({ ...base, branchPinned: true, branchMemberIds: ["t"] })).toBe(true);
    expect(canNudge({ ...base, branchPinned: true, branchMemberIds: ["x"] })).toBe(false);
  });
  it("the message names the manager and the count", () => {
    expect(nudgeMessage("Sadin", 14).message).toBe("Sadin asked you to look at 14 leads that haven't had a touch yet.");
    expect(nudgeMessage("Sadin", 1).message).toContain("1 lead that");
  });
});

describe("managerDisplayName", () => {
  it("prefers the profile name, falls back to the email prefix, then a generic label", () => {
    expect(managerDisplayName(new Map([["m", "Sadin Shrestha"]]), "m", "sadin@zunkireelabs.com")).toBe("Sadin Shrestha");
    expect(managerDisplayName(new Map(), "m", "sadin@zunkireelabs.com")).toBe("sadin");
    expect(managerDisplayName(new Map([["m", "  "]]), "m", null)).toBe("Your manager");
  });
});

describe("quietOverRow (managers: leads with no contact for over 2 weeks)", () => {
  it("one item, grouped by person: the top 3 in the grey line, with the scope", () => {
    const r = quietOverRow(215, [{ name: "Gautam", count: 101 }, { name: "Kamana", count: 85 }, { name: "Rita", count: 20 }, { name: "Asha", count: 9 }], "all branches")!;
    expect(r.title).toBe("215 leads with no contact for over 2 weeks");
    expect(r.why).toBe("Gautam 101 · Kamana 85 · Rita 20 and 1 more person · all branches");
    expect(r.actions).toEqual([{ type: "link", label: "Review", href: "/leads" }]);
  });
  it("none → no row; no bulk action ever", () => {
    expect(quietOverRow(0, [], "all branches")).toBeNull();
    expect(quietOverRow(1, [], "Kathmandu")!.why).toBe("Kathmandu");
  });
});

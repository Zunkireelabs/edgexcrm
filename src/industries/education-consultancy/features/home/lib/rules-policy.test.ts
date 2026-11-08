import { describe, expect, it } from "vitest";
import { lead } from "./fixtures";
import { buildDoNext } from "./build";
import { lateLabel, newUncalledRule, whenLabel } from "./rules/new-uncalled";
import { unreachableRule } from "./rules/unreachable";
import type { HomePolicy } from "./rules/ctx";
import { rankItems } from "./rank";
import { firstHourCounts, firstHourLabel } from "./week-stats";
import { workingDeadline } from "../../processes/lib/working-hours";
import type { HomeLead } from "./types";

const KTM = "Asia/Kathmandu";
const OH = { days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "saved" as const };
const WORKING: HomePolicy = { live: true, firstContact: { minutes: 60, clock: "working" }, officeHours: OH, unreachableAfterCalls: 3 };
const CLOCK: HomePolicy = { ...WORKING, firstContact: { minutes: 60, clock: "clock" } };
// T1's moment: Sunday 8 Nov 2026, 11:05 am in Kathmandu (UTC+5:45).
const NOW = new Date("2026-11-08T05:20:00.000Z");
const ctx = (policy?: HomePolicy, tz = KTM, now = NOW) => ({ now, tz, policy });
const arrived = (id: string, name: string, iso: string, o: Partial<HomeLead> = {}) => lead({ id, name, assignedAt: iso, createdAt: iso, context: "Website form · Canada", ...o });

describe("new_uncalled on the live working clock (T1)", () => {
  const bikash = arrived("l-b", "Bikash Gurung", "2026-11-07T14:25:00.000Z"); // Saturday 8:10 pm, closed
  const sneha = arrived("l-s", "Sneha Rai", "2026-11-08T03:45:00.000Z"); // Sunday 9:30 am
  const arjun = arrived("l-a", "Arjun Thapa", "2026-11-08T05:07:00.000Z"); // Sunday 10:52 am

  it("a Saturday-night lead is on the clock from Sunday 9:00: due 10:00, 'Late · 1 h 5 min' at 11:05, why-line says closed + due", () => {
    const [i] = newUncalledRule([bikash], ctx(WORKING));
    expect(i.chip).toEqual({ text: "Late · 1 h 5 min", tone: "bad" });
    expect(i.tone).toBe("bad");
    expect(i.why).toBe("Website form · Canada · arrived Sat 8:10 pm (closed) · due 10:00 am · no contact yet");
  });
  it("arrived inside office hours: due = arrival + 60 office minutes, so the why-line has no 'due'", () => {
    const [i] = newUncalledRule([sneha], ctx(WORKING));
    expect(i.chip).toEqual({ text: "Late · 35 min", tone: "bad" });
    expect(i.why).toBe("Website form · Canada · arrived 9:30 am · no contact yet");
  });
  it("before the deadline: blue 'New · call by 11:52 am'", () => {
    const [i] = newUncalledRule([arjun], ctx(WORKING));
    expect(i.chip).toEqual({ text: "New · call by 11:52 am", tone: "new" });
    expect(i.tone).toBe("new");
    expect(i.why).toBe("Website form · Canada · arrived 10:52 am · no contact yet");
  });
  it("sort: late rows first (oldest deadline first), then the upcoming ones by deadline", () => {
    const items = rankItems(newUncalledRule([arjun, sneha, bikash], ctx(WORKING)));
    expect(items.map((i) => i.title)).toEqual(["Bikash Gurung", "Sneha Rai", "Arjun Thapa"]);
  });
  it("a deadline on another day names the weekday: 'call by Sun 10:00 am' for a Saturday evening lead seen on Saturday", () => {
    const satEvening = new Date("2026-11-07T14:40:00.000Z"); // Sat 8:25 pm
    const [i] = newUncalledRule([bikash], ctx(WORKING, KTM, satEvening));
    expect(i.chip).toEqual({ text: "New · call by Sun 10:00 am", tone: "new" });
  });
  it("exactly at the deadline is not late yet; one minute after is", () => {
    const at = new Date("2026-11-08T04:15:00.000Z");
    expect(newUncalledRule([bikash], ctx(WORKING, KTM, at))[0].chip.tone).toBe("new");
    expect(newUncalledRule([bikash], ctx(WORKING, KTM, new Date(at.getTime() + 60_000)))[0].chip).toEqual({ text: "Late · 1 min", tone: "bad" });
  });
  it("late is counted in WORKING minutes: Thursday 17:40 arrival (20 office minutes left that day), seen Friday 9:50 → deadline Fri 9:40 → 10 min late", () => {
    const thu = arrived("l-t", "Thu Lead", "2026-11-05T11:55:00.000Z"); // Thu 17:40 NPT
    const fri950 = new Date("2026-11-06T04:05:00.000Z");
    const [i] = newUncalledRule([thu], ctx(WORKING, KTM, fri950));
    expect(i.chip).toEqual({ text: "Late · 10 min", tone: "bad" });
  });
  it("a foreign timezone: New York Mon–Fri 9–17, Friday 4:45 pm lead seen Monday 10:00 → due Mon 9:45, 15 min late", () => {
    const ny = { ...WORKING, officeHours: { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, source: "saved" as const } };
    const fri = arrived("l-n", "NY Lead", "2026-11-06T21:45:00.000Z");
    const [i] = newUncalledRule([fri], ctx(ny, "America/New_York", new Date("2026-11-09T15:00:00.000Z")));
    expect(i.chip).toEqual({ text: "Late · 15 min", tone: "bad" });
    expect(i.why).toBe("Website form · Canada · arrived Fri 4:45 pm · due 9:45 am · no contact yet");
  });
});

describe("new_uncalled on the plain clock", () => {
  it("60 clock minutes: an arrival on Saturday night is NOT given until Sunday: it is late 60 minutes after it arrived", () => {
    const bikash = arrived("l-b", "Bikash Gurung", "2026-11-07T14:25:00.000Z");
    const [i] = newUncalledRule([bikash], ctx(CLOCK));
    expect(i.chip.tone).toBe("bad");
    expect(i.chip.text).toMatch(/^Late · /);
    expect(i.why).not.toContain("(closed)");
    expect(i.why).not.toContain("due");
  });
  it("before the hour is up: 'call by' 60 clock minutes after arrival", () => {
    const l = arrived("l-x", "X", "2026-11-08T05:00:00.000Z"); // 10:45 am
    expect(newUncalledRule([l], ctx(CLOCK))[0].chip).toEqual({ text: "New · call by 11:45 am", tone: "new" });
  });
  it("a longer window comes from the process (90 minutes)", () => {
    const l = arrived("l-x", "X", "2026-11-08T05:00:00.000Z");
    expect(newUncalledRule([l], ctx({ ...CLOCK, firstContact: { minutes: 90, clock: "clock" } }))[0].chip.text).toBe("New · call by 12:15 pm");
  });
});

describe("new_uncalled without a live process (today)", () => {
  it("no policy, or a policy that is not live: the plain age chip", () => {
    const l = arrived("l-x", "X", "2026-11-08T05:00:00.000Z");
    expect(newUncalledRule([l], ctx(undefined))[0].chip).toEqual({ text: "New · 20 min", tone: "new" });
    expect(newUncalledRule([l], ctx({ ...WORKING, live: false }))[0].chip).toEqual({ text: "New · 20 min", tone: "new" });
  });
});

describe("label helpers", () => {
  it("lateLabel", () => {
    expect([lateLabel(0), lateLabel(35), lateLabel(65), lateLabel(120), lateLabel(60 * 60)]).toEqual(["1 min", "35 min", "1 h 5 min", "2 h", "2 days"]);
  });
  it("whenLabel: clock today, weekday + clock otherwise (tenant zone)", () => {
    expect(whenLabel(new Date("2026-11-08T05:07:00.000Z"), NOW, KTM)).toBe("10:52 am");
    expect(whenLabel(new Date("2026-11-07T14:25:00.000Z"), NOW, KTM)).toBe("Sat 8:10 pm");
  });
});

describe("unreachable follows the process", () => {
  const calls = (n: number) => Array.from({ length: n }, (_, i) => ({ type: "call" as const, outcome: "no_answer", at: `2026-11-0${7 - i}T05:00:00.000Z` }));
  const l = (n: number) => lead({ recentContacts: calls(n) });
  it("default is 3", () => {
    expect(unreachableRule([l(2)], ctx(undefined))).toHaveLength(0);
    expect(unreachableRule([l(3)], ctx(undefined))).toHaveLength(1);
    expect(unreachableRule([l(3)], ctx({ ...WORKING, live: false, unreachableAfterCalls: 5 }))).toHaveLength(1);
  });
  it("a live process's rules block sets it", () => {
    expect(unreachableRule([l(3)], ctx({ ...WORKING, unreachableAfterCalls: 5 }))).toHaveLength(0);
    expect(unreachableRule([l(5)], ctx({ ...WORKING, unreachableAfterCalls: 5 }))[0].chip.text).toBe("5 calls unanswered");
    expect(unreachableRule([l(2)], ctx({ ...WORKING, unreachableAfterCalls: 2 }))).toHaveLength(1);
  });
});

describe("buildDoNext carries the policy through", () => {
  it("a late lead shows in the Now tier with the red chip", () => {
    const r = buildDoNext(
      { userId: "u1", leads: [arrived("l-b", "Bikash Gurung", "2026-11-07T14:25:00.000Z")], conversations: [], tasks: [], applications: [], submitStageByPipeline: new Map(), medianDwellDays: new Map(), snoozedKeys: new Set() },
      ctx(WORKING),
    );
    expect(r.items[0]).toMatchObject({ tier: "now", kind: "new_uncalled", chip: { text: "Late · 1 h 5 min", tone: "bad" } });
  });
});

describe("your last 7 days follows the clock", () => {
  it("label", () => {
    expect(firstHourLabel("working")).toBe("New leads called within 1 working hour");
    expect(firstHourLabel("clock")).toBe("New leads called within 1 hour");
  });
  it("a Saturday-night lead called Sunday 9:50 counts under the working clock, not under 60 clock minutes", () => {
    const at = Date.parse("2026-11-07T14:25:00.000Z");
    const leads = [{ id: "a", assignedAt: at }];
    const contacts = new Map([["a", [Date.parse("2026-11-08T04:05:00.000Z")]]]); // Sun 9:50
    const from = at - 1000;
    const to = at + 86_400_000 * 2;
    expect(firstHourCounts(leads, contacts, from, to)).toEqual({ called: 0, total: 1 });
    expect(firstHourCounts(leads, contacts, from, to, (a) => workingDeadline(new Date(a), 60, OH, KTM).getTime())).toEqual({ called: 1, total: 1 });
  });
});

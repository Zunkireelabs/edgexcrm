import { describe, expect, it } from "vitest";
import { app, conv, lead, task } from "./fixtures";
import { callbackRules } from "./rules/callbacks";
import { deadlineDocsRule } from "./rules/deadline-docs";
import { goingQuietRule } from "./rules/going-quiet";
import { newUncalledRule } from "./rules/new-uncalled";
import { replyWaitingRule } from "./rules/reply-waiting";
import { stuckInStageRule } from "./rules/stuck-in-stage";
import { taskDueRule } from "./rules/task-due";
import { isSubmitted } from "./submitted";

// Monday 9 Nov 2026, 10:00 in Kathmandu (UTC+5:45) = 04:15 UTC.
const now = new Date("2026-11-09T04:15:00.000Z");
const KTM = { now, tz: "Asia/Kathmandu" };
const UTC = { now, tz: "UTC" };
const SUBMIT = new Map<string | null, number>([["p1", 2]]);

describe("new_uncalled", () => {
  it("fires for an assigned, untouched lead and shows its age", () => {
    const [i] = newUncalledRule([lead()], KTM);
    expect(i.kind).toBe("new_uncalled");
    expect(i.tier).toBe("now");
    expect(i.chip.text).toBe("New · 15 min");
    expect(i.why).toContain("no contact yet");
  });
  it("clears when any touch lands at or after assignment", () => {
    expect(newUncalledRule([lead({ lastTouchedAt: "2026-11-09T04:05:00.000Z" })], KTM)).toEqual([]);
  });
  it("still fires when the only touch is BEFORE assignment (previous holder)", () => {
    expect(newUncalledRule([lead({ lastTouchedAt: "2026-11-08T01:00:00.000Z" })], KTM)).toHaveLength(1);
  });
  it("ignores leads assigned more than 14 days ago, and inactive leads", () => {
    expect(newUncalledRule([lead({ assignedAt: "2026-10-20T00:00:00.000Z" })], KTM)).toEqual([]);
    expect(newUncalledRule([lead({ isActive: false })], KTM)).toEqual([]);
  });
  it("falls back to created_at when assigned_at is null (pre-migration rows)", () => {
    expect(newUncalledRule([lead({ assignedAt: null, createdAt: "2026-11-08T00:00:00.000Z" })], KTM)).toHaveLength(1);
  });
  it("an old same-day-vs-yesterday lead reads as weekday + time in the TENANT zone", () => {
    const [i] = newUncalledRule([lead({ assignedAt: "2026-11-07T10:40:00.000Z" })], KTM); // Sat 4:25 pm Kathmandu
    expect(i.chip.text).toBe("New · Sat 4:25 pm");
  });
});

describe("reply_waiting", () => {
  it("fires on a last-inbound open conversation", () => {
    const [i] = replyWaitingRule([conv()], KTM);
    expect(i.kind).toBe("reply_waiting");
    expect(i.chip.text).toBe("Replied 15 min ago");
    expect(i.primaryAction).toEqual({ type: "reply", href: "/inbox?conversation=c1" });
  });
  it("clears on an outbound message, closed, or still-snoozed", () => {
    expect(replyWaitingRule([conv({ lastDirection: "outbound" })], KTM)).toEqual([]);
    expect(replyWaitingRule([conv({ status: "closed" })], KTM)).toEqual([]);
    expect(replyWaitingRule([conv({ status: "snoozed", snoozedUntil: "2026-11-10T00:00:00.000Z" })], KTM)).toEqual([]);
  });
  it("a snooze that has expired counts again", () => {
    expect(replyWaitingRule([conv({ status: "snoozed", snoozedUntil: "2026-11-09T01:00:00.000Z" })], KTM)).toHaveLength(1);
  });
});

describe("callbacks (leads.callback_due_at)", () => {
  it("overdue = due before now, reported in calendar days of the tenant zone", () => {
    const [i] = callbackRules([lead({ callbackDueAt: "2026-11-08T10:15:00.000Z", lastCallOutcome: "no_answer" })], KTM);
    expect(i.kind).toBe("callback_overdue");
    expect(i.tier).toBe("now");
    expect(i.chip.text).toBe("Overdue 1 day");
    expect(i.why).toBe("Call back was due yesterday at 4:00 pm · last call: no answer");
  });
  it("due earlier today is overdue in hours, not 'today'", () => {
    const [i] = callbackRules([lead({ callbackDueAt: "2026-11-09T02:15:00.000Z" })], KTM);
    expect(i.kind).toBe("callback_overdue");
    expect(i.chip.text).toBe("Overdue 2 h");
  });
  it("today = later today in the tenant zone; clock is tenant-local", () => {
    const [i] = callbackRules([lead({ callbackDueAt: "2026-11-09T05:45:00.000Z" })], KTM); // 11:30 Kathmandu
    expect(i.kind).toBe("callback_today");
    expect(i.tier).toBe("today");
    expect(i.chip.text).toBe("Call back 11:30 am");
  });
  it("UTC vs Kathmandu: 19:00 UTC on the 9th is already TOMORROW in Kathmandu (00:45 on the 10th)", () => {
    const due = "2026-11-09T19:00:00.000Z";
    expect(callbackRules([lead({ callbackDueAt: due })], UTC)[0].kind).toBe("callback_today");
    expect(callbackRules([lead({ callbackDueAt: due })], KTM)).toEqual([]);
  });
  it("a cleared callback (null) produces nothing", () => {
    expect(callbackRules([lead({ callbackDueAt: null })], KTM)).toEqual([]);
  });
});

describe("task_due", () => {
  it("due today → today tier; overdue → now tier; future / done → nothing", () => {
    expect(taskDueRule([task()], KTM)[0].tier).toBe("today");
    const od = taskDueRule([task({ dueDate: "2026-11-06" })], KTM)[0];
    expect(od.tier).toBe("now");
    expect(od.chip.text).toBe("Task · overdue 3 days");
    expect(taskDueRule([task({ dueDate: "2026-11-10" })], KTM)).toEqual([]);
    expect(taskDueRule([task({ status: "done" })], KTM)).toEqual([]);
  });
  it("'today' is the tenant-local date: 23:00 UTC on the 8th is already the 9th in Kathmandu", () => {
    const lateUtc = { now: new Date("2026-11-08T23:00:00.000Z") };
    expect(taskDueRule([task()], { ...lateUtc, tz: "Asia/Kathmandu" })).toHaveLength(1);
    expect(taskDueRule([task()], { ...lateUtc, tz: "UTC" })).toEqual([]);
  });
});

describe("isSubmitted", () => {
  const stage = (position: number, terminalType: "won" | "lost" | null = null, pipelineId: string | null = "p1") => ({ position, terminalType, pipelineId });
  it("true when applied_date is set", () => expect(isSubmitted({ appliedDate: "2026-11-01", stage: stage(0) }, SUBMIT)).toBe(true));
  it("true when terminal", () => expect(isSubmitted({ appliedDate: null, stage: stage(0, "lost") }, SUBMIT)).toBe(true));
  it("true at or after the pipeline's submit stage", () => {
    expect(isSubmitted({ appliedDate: null, stage: stage(2) }, SUBMIT)).toBe(true);
    expect(isSubmitted({ appliedDate: null, stage: stage(5) }, SUBMIT)).toBe(true);
  });
  it("false before the submit stage", () => expect(isSubmitted({ appliedDate: null, stage: stage(1) }, SUBMIT)).toBe(false));
  it("'unknown' when the pipeline has no submit stage", () => {
    expect(isSubmitted({ appliedDate: null, stage: stage(1, null, "other") }, SUBMIT)).toBe("unknown");
  });
});

describe("deadline_docs", () => {
  it("fires: deadline within 7 days, not submitted, a document missing", () => {
    const [i] = deadlineDocsRule([app()], SUBMIT, KTM);
    expect(i.kind).toBe("deadline_docs");
    expect(i.chip).toEqual({ text: "Closes in 6 days", tone: "warn" });
    expect(i.why).toBe("Deakin · Master of IT · Bank statement missing · 3 of 4 in");
  });
  it("names the missing documents: up to two, then 'and N more'; 'N of M in' only when something is in", () => {
    const docs = (missingLabels: string[], requiredCount: number) => ({ assessable: true, missingLabels, requiredCount });
    expect(deadlineDocsRule([app({ docs: docs(["Passport", "Bank statement"], 4) })], SUBMIT, KTM)[0].why).toBe("Deakin · Master of IT · Passport and Bank statement missing · 2 of 4 in");
    expect(deadlineDocsRule([app({ docs: docs(["Passport", "Bank statement", "CV"], 4) })], SUBMIT, KTM)[0].why).toBe("Deakin · Master of IT · Passport, Bank statement and 1 more missing · 1 of 4 in");
    expect(deadlineDocsRule([app({ docs: docs(["Passport", "Bank statement", "CV"], 3) })], SUBMIT, KTM)[0].why).toBe("Deakin · Master of IT · Passport, Bank statement and 1 more missing");
  });
  it("closes today / within 2 days is red", () => {
    expect(deadlineDocsRule([app({ deadline: "2026-11-09" })], SUBMIT, KTM)[0].chip).toEqual({ text: "Closes today", tone: "bad" });
  });
  it("not in the window: past, or more than 7 days away", () => {
    expect(deadlineDocsRule([app({ deadline: "2026-11-08" })], SUBMIT, KTM)).toEqual([]);
    expect(deadlineDocsRule([app({ deadline: "2026-11-17" })], SUBMIT, KTM)).toEqual([]);
  });
  it("never fires when submitted, when submission is unknown, or when docs can't be assessed", () => {
    expect(deadlineDocsRule([app({ appliedDate: "2026-11-01" })], SUBMIT, KTM)).toEqual([]);
    expect(deadlineDocsRule([app()], new Map(), KTM)).toEqual([]);
    expect(deadlineDocsRule([app({ docs: { assessable: false, missingLabels: [], requiredCount: 0 } })], SUBMIT, KTM)).toEqual([]);
  });
  it("clears when nothing is missing", () => {
    expect(deadlineDocsRule([app({ docs: { assessable: true, missingLabels: [], requiredCount: 4 } })], SUBMIT, KTM)).toEqual([]);
  });
});

describe("going_quiet (5-14 tenant-local days since contact)", () => {
  // Now = Mon 9 Nov 10:00 Kathmandu. Last contact at 12:00 Kathmandu (06:15Z) `days` calendar days ago.
  const quiet = (id: string, name: string, days: number, o = {}) =>
    lead({ id, name, lastTouchedAt: new Date(Date.UTC(2026, 10, 9 - days, 6, 15)).toISOString(), assignedAt: "2026-09-01T00:00:00.000Z", ...o });

  it("is ONE grouped row: range, names (up to 3), and a sheet action that opens exactly those leads", () => {
    const items = goingQuietRule([quiet("a", "Ramesh", 9), quiet("b", "Dipa", 6), quiet("c", "Saroj", 5), quiet("d", "Mina", 7)], KTM, "u1");
    expect(items).toHaveLength(1);
    const g = items[0];
    expect(g.title).toBe("4 Qualified leads going quiet");
    expect(g.chip.text).toBe("5\u20139 days since last contact");
    expect(g.why).toBe("Ramesh, Mina, Dipa and 1 more");
    expect(g.primaryAction).toEqual({ type: "sheet", label: "Open 4" });
    expect(g.children!.map((c) => c.title)).toEqual(["Ramesh", "Mina", "Dipa", "Saroj"]); // longest quiet first
    expect(g.children!.every((c) => c.primaryAction.type === "call")).toBe(true);
  });

  it("boundaries: day 4 is not quiet yet, day 5 is, day 14 is, day 15 is OFF the personal list", () => {
    const kinds = (days: number) => goingQuietRule([quiet("x", "X", days)], KTM, "u1").length;
    expect(kinds(4)).toBe(0);
    expect(kinds(5)).toBe(1);
    expect(kinds(14)).toBe(1);
    expect(kinds(15)).toBe(0);
    expect(kinds(100)).toBe(0);
  });

  it("days are tenant-local calendar days, not 24-hour blocks", () => {
    // Last contact 2026-11-04 23:30 Kathmandu (17:45Z): 5 calendar days ago, though only ~4.4 days (106 h) back.
    const l = lead({ id: "e", lastTouchedAt: "2026-11-04T17:45:00.000Z", assignedAt: "2026-09-01T00:00:00.000Z" });
    expect(goingQuietRule([l], KTM, "u").length).toBe(1);
    // The same instant in UTC is 2026-11-04 → also 5 days; contact at 2026-11-04T23:30Z is 5 days in UTC but 4 in Kathmandu.
    const m = lead({ id: "f", lastTouchedAt: "2026-11-04T23:30:00.000Z", assignedAt: "2026-09-01T00:00:00.000Z" });
    expect(goingQuietRule([m], UTC, "u").length).toBe(1);
    expect(goingQuietRule([m], KTM, "u").length).toBe(0);
  });

  it("a note counts as contact (last_touched_at), so a recent note keeps the lead off the list", () => {
    expect(goingQuietRule([quiet("n", "N", 1)], KTM, "u1")).toEqual([]);
  });

  it("skips on-hold, inactive and already-listed leads", () => {
    const items = goingQuietRule([quiet("b", "B", 8, { onHold: true }), quiet("c", "C", 8, { isActive: false }), quiet("d", "D", 8)], KTM, "u1", new Set(["d"]));
    expect(items).toEqual([]);
  });

  it("a never-touched lead is judged from when it reached the person", () => {
    const l = lead({ id: "g", lastTouchedAt: null, assignedAt: new Date(Date.UTC(2026, 10, 1, 6, 15)).toISOString() }); // 8 days ago
    expect(goingQuietRule([l], KTM, "u")[0].chip.text).toBe("8 days since last contact");
  });
});

describe("stuck_in_stage", () => {
  const stuck = (days: number, o = {}) => app({ stageName: "Offer", stageChangedAt: new Date(now.getTime() - days * 86_400_000).toISOString(), ...o });
  it("needs 14+ days even when the usual is short", () => {
    expect(stuckInStageRule([stuck(10)], new Map([["Offer", 3]]), KTM)).toEqual([]);
    expect(stuckInStageRule([stuck(15)], new Map([["Offer", 3]]), KTM)).toHaveLength(1);
  });
  it("needs more than 2x the usual dwell when that is longer", () => {
    expect(stuckInStageRule([stuck(18)], new Map([["Offer", 10]]), KTM)).toEqual([]);
    const [i] = stuckInStageRule([stuck(21)], new Map([["Offer", 10]]), KTM);
    expect(i.chip.text).toBe("In Offer for 21 days");
    expect(i.why).toContain("usually leave Offer in 10 days");
  });
  it("without history the 14-day floor alone applies; terminal never counts", () => {
    expect(stuckInStageRule([stuck(15)], new Map(), KTM)).toHaveLength(1);
    expect(stuckInStageRule([stuck(40, { stage: { position: 9, terminalType: "won", pipelineId: "p1" } })], new Map(), KTM)).toEqual([]);
  });
});

describe("one time format", () => {
  it("chips use '9:08 pm' style in the tenant zone, like the why-lines", () => {
    // 15:23 UTC = 21:08 in Kathmandu
    const [i] = callbackRules([lead({ callbackDueAt: "2026-11-09T15:23:00.000Z", lastTouchedAt: "2026-11-09T01:00:00.000Z" })], KTM);
    expect(i.chip.text).toBe("Call back 9:08 pm");
  });
});

import { isStaleCallback } from "./rules/callbacks";
import { unreachableRule, unansweredStreak } from "./rules/unreachable";
import { buildDoNext } from "./build";

// Now = Mon 9 Nov 2026 10:00 Kathmandu. A call-back due at 10:15 Kathmandu on a given earlier day is "N days overdue".
const dueDaysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000 - 15 * 60_000 + 15 * 60_000 - 60_000).toISOString();

describe("call-back reminders by age (tenant-local days)", () => {
  const L = (id: string, name: string, days: number) => lead({ id, name, lastTouchedAt: "2026-11-09T01:00:00.000Z", assignedAt: "2026-09-01T00:00:00.000Z", callbackDueAt: dueDaysAgo(days) });

  it("0-2 days overdue are 'now' rows, NEWEST first", () => {
    const items = callbackRules([L("a", "Two days", 2), L("b", "Yesterday", 1), L("c", "Today early", 0.2)], KTM);
    expect(items.every((i) => i.kind === "callback_overdue" && i.tier === "now")).toBe(true);
    const ordered = [...items].sort((x, y) => x.sortKey.at - y.sortKey.at).map((i) => i.title);
    expect(ordered).toEqual(["Today early", "Yesterday", "Two days"]);
  });

  it("the 2-day boundary is by tenant-local calendar day, not 48 hours", () => {
    // 2026-11-07 00:30 Kathmandu = 2026-11-06T18:45Z: calendar day diff 2 → still a 'now' row even though 57+ hours ago.
    const twoDays = callbackRules([lead({ lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-06T18:45:00.000Z" })], KTM);
    expect(twoDays[0].kind).toBe("callback_overdue");
    // 2026-11-06 23:30 Kathmandu = 17:45Z on the 6th: calendar day diff 3 → grouped, although only ~58 h ago.
    const threeDays = callbackRules([lead({ lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-06T17:45:00.000Z" })], KTM);
    expect(threeDays.map((i) => i.kind)).toEqual(["missed_callbacks"]);
    // The same instant judged in UTC is the 6th, three days back: the zone decides which side it lands on.
    expect(callbackRules([lead({ lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-06T18:45:00.000Z" })], UTC)[0].kind).toBe("missed_callbacks");
  });

  it("3-14 days are ONE grouped 'N missed call-backs' row in this week, carrying exactly those leads", () => {
    const items = callbackRules([L("a", "Three", 3), L("b", "Ten", 10), L("c", "Fourteen", 14), L("d", "Recent", 1)], KTM);
    const g = items.find((i) => i.kind === "missed_callbacks")!;
    expect(g.tier).toBe("week");
    expect(g.title).toBe("3 missed call-backs");
    expect(g.chip.text).toBe("3–14 days old");
    expect(g.primaryAction).toEqual({ type: "sheet", label: "Call through them" });
    expect(g.children!.map((c) => c.title)).toEqual(["Three", "Ten", "Fourteen"]);
    expect(g.children!.every((c) => c.primaryAction.type === "call")).toBe(true);
    expect(items.filter((i) => i.kind === "callback_overdue").map((i) => i.title)).toEqual(["Recent"]);
  });

  it("over 14 days never reaches a personal list (day 15 is stale, day 14 is not)", () => {
    expect(callbackRules([L("a", "Old", 15), L("b", "Older", 40)], KTM)).toEqual([]);
    expect(isStaleCallback(dueDaysAgo(15), KTM)).toBe(true);
    expect(isStaleCallback(dueDaysAgo(14), KTM)).toBe(false);
    expect(isStaleCallback(null, KTM)).toBe(false);
    expect(isStaleCallback("2026-11-10T00:00:00.000Z", KTM)).toBe(false); // not yet due
  });

  it("the group's children are newest first, like the rows", () => {
    const g = callbackRules([L("a", "Older", 9), L("b", "Newer", 4)], KTM)[0];
    expect(g.children!.map((c) => c.title)).toEqual(["Newer", "Older"]);
  });
});

describe("unreachable", () => {
  const calls = (...o: Array<string | "note" | "email">) =>
    o.map((x, i) => ({ type: (x === "note" ? "note" : x === "email" ? "email" : "call") as "call" | "note" | "email", outcome: x === "note" || x === "email" ? null : x, at: new Date(now.getTime() - (i + 1) * 3_600_000).toISOString() }));
  const U = (recent: ReturnType<typeof calls>, o = {}) => lead({ id: "u1", name: "Unreachable", lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-08T01:00:00.000Z", recentContacts: recent, ...o });

  it("fires when the last 3 contacts are all unanswered calls", () => {
    const [i] = unreachableRule([U(calls("no_answer", "busy", "no_answer"))], KTM);
    expect(i.kind).toBe("unreachable");
    expect(i.tier).toBe("today");
    expect(i.chip.text).toBe("3 calls unanswered");
    expect(i.primaryAction).toEqual({ type: "open", href: "/leads/u1", label: "Open lead" });
  });
  it("counts the whole streak", () => {
    expect(unreachableRule([U(calls("no_answer", "busy", "no_answer", "busy"))], KTM)[0].chip.text).toBe("4 calls unanswered");
  });
  it("a note, email or connected call in between breaks it", () => {
    expect(unreachableRule([U(calls("no_answer", "note", "no_answer", "no_answer"))], KTM)).toEqual([]);
    expect(unreachableRule([U(calls("no_answer", "no_answer", "email", "no_answer"))], KTM)).toEqual([]);
    expect(unreachableRule([U(calls("no_answer", "no_answer", "connected", "no_answer"))], KTM)).toEqual([]);
    expect(unansweredStreak({ recentContacts: calls("no_answer", "no_answer", "connected") })).toBe(2);
  });
  it("fewer than 3 does not fire", () => {
    expect(unreachableRule([U(calls("no_answer", "busy"))], KTM)).toEqual([]);
    expect(unreachableRule([lead()], KTM)).toEqual([]);
  });
  it("an unreachable lead is NOT also a call-back row or a going-quiet row, whatever the call-back's age", () => {
    const l = U(calls("no_answer", "busy", "no_answer"), { callbackDueAt: "2026-11-08T05:00:00.000Z", lastTouchedAt: "2026-10-01T00:00:00.000Z", assignedAt: "2026-09-01T00:00:00.000Z" });
    const r = buildDoNext({ userId: "me", leads: [l], conversations: [], tasks: [], applications: [], submitStageByPipeline: new Map(), medianDwellDays: new Map(), snoozedKeys: new Set() }, KTM);
    expect(r.items.map((i) => i.kind)).toEqual(["unreachable"]);
  });
  it("snoozing the unreachable row hides it without resurrecting the call-back", () => {
    const l = U(calls("no_answer", "busy", "no_answer"), { callbackDueAt: "2026-11-08T05:00:00.000Z", assignedAt: "2026-10-20T00:00:00.000Z", lastTouchedAt: "2026-11-09T01:00:00.000Z" });
    const r = buildDoNext({ userId: "me", leads: [l], conversations: [], tasks: [], applications: [], submitStageByPipeline: new Map(), medianDwellDays: new Map(), snoozedKeys: new Set(["unreachable:u1"]) }, KTM);
    expect(r.items).toEqual([]);
  });
});

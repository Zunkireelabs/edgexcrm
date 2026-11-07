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
    expect(i.why).toContain("not called yet");
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
    expect(i.chip.text).toBe("Call back 11:30");
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
    expect(i.why).toBe("Deakin · Master of IT · bank statement missing (3 of 4 documents in)");
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

describe("going_quiet", () => {
  const quiet = (id: string, name: string, days: number, o = {}) =>
    lead({ id, name, lastTouchedAt: new Date(now.getTime() - days * 86_400_000).toISOString(), assignedAt: "2026-09-01T00:00:00.000Z", ...o });
  it("is ONE grouped row with the range and names", () => {
    const items = goingQuietRule([quiet("a", "Ramesh", 9), quiet("b", "Dipa", 6), quiet("c", "Saroj", 5), quiet("d", "Mina", 7)], KTM, "u1");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("4 Qualified leads going quiet");
    expect(items[0].chip.text).toBe("5–9 days since last touch");
    expect(items[0].why).toBe("Ramesh, Mina, Dipa and 1 more");
  });
  it("skips fresh, on-hold, inactive and already-listed leads", () => {
    const items = goingQuietRule([quiet("a", "A", 4), quiet("b", "B", 8, { onHold: true }), quiet("c", "C", 8, { isActive: false }), quiet("d", "D", 8)], KTM, "u1", new Set(["d"]));
    expect(items).toEqual([]);
  });
  it("clears on any touch (a fresh last_touched_at)", () => {
    expect(goingQuietRule([quiet("a", "A", 0)], KTM, "u1")).toEqual([]);
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

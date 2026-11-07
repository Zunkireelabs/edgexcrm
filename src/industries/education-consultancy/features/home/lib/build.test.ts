import { describe, expect, it } from "vitest";
import { buildDoNext, filterItems, type HomeInputs } from "./build";
import { app, conv, lead, task } from "./fixtures";
import { rankItems } from "./rank";
import { buildAgenda } from "./agenda";

const now = new Date("2026-11-09T04:15:00.000Z");
const ctx = { now, tz: "Asia/Kathmandu" };

const base = (o: Partial<HomeInputs> = {}): HomeInputs => ({
  userId: "me",
  leads: [],
  conversations: [],
  tasks: [],
  applications: [],
  submitStageByPipeline: new Map([["p1", 2]]),
  medianDwellDays: new Map(),
  snoozedKeys: new Set(),
  ...o,
});

describe("ranking", () => {
  it("now: overdue call-backs and overdue tasks, then replies, then new leads; oldest first inside each", () => {
    const r = buildDoNext(
      base({
        leads: [
          lead({ id: "n1", name: "Newer", assignedAt: "2026-11-09T04:00:00.000Z" }),
          lead({ id: "n2", name: "Older", assignedAt: "2026-11-09T03:00:00.000Z" }),
          lead({ id: "cb", name: "Anjali", assignedAt: "2026-10-30T00:00:00.000Z", lastTouchedAt: "2026-11-08T00:00:00.000Z", callbackDueAt: "2026-11-08T10:15:00.000Z" }),
        ],
        conversations: [conv({ id: "r2", contactName: "Late", lastMessageAt: "2026-11-09T03:55:00.000Z" }), conv({ id: "r1", contactName: "Early", lastMessageAt: "2026-11-09T01:00:00.000Z" })],
        tasks: [task({ id: "t", title: "Overdue task", dueDate: "2026-11-05" })],
      }),
      ctx,
    );
    expect(r.items.map((i) => i.title)).toEqual(["Overdue task", "Anjali", "Early", "Late", "Older", "Newer"]);
  });
  it("tier order now → today → week, and today: timed call-backs, deadlines by days left, then tasks", () => {
    const r = buildDoNext(
      base({
        leads: [lead({ id: "cb", name: "Nabin", assignedAt: "2026-11-01T00:00:00.000Z", lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-09T05:45:00.000Z" })],
        applications: [app({ id: "a2", leadName: "Later", deadline: "2026-11-15" }), app({ id: "a1", leadName: "Sooner", deadline: "2026-11-12" })],
        tasks: [task()],
      }),
      ctx,
    );
    expect(r.items.map((i) => i.title)).toEqual(["Nabin", "Sooner", "Later", "Send SOP feedback"]);
  });
  it("is deterministic: ties break on title then key", () => {
    const items = buildDoNext(base({ leads: [lead({ id: "b", name: "Same" }), lead({ id: "a", name: "Same" })] }), ctx).items;
    expect(rankItems([...items].reverse()).map((i) => i.key)).toEqual(items.map((i) => i.key));
  });
});

describe("scoping and snooze", () => {
  it("only reads what it is given: another person's lead can't appear (the loader filters to assigned_to = me)", () => {
    const r = buildDoNext(base({ leads: [] }), ctx);
    expect(r.items).toEqual([]);
    expect(r.counts.all).toBe(0);
  });
  it("snoozed keys disappear", () => {
    const r = buildDoNext(base({ leads: [lead()], snoozedKeys: new Set(["new_uncalled:l1"]) }), ctx);
    expect(r.items).toEqual([]);
  });
  it("a lead already listed is not also 'going quiet'", () => {
    const l = lead({ id: "x", assignedAt: "2026-11-01T00:00:00.000Z", lastTouchedAt: "2026-11-02T00:00:00.000Z", callbackDueAt: "2026-11-08T10:15:00.000Z" });
    const r = buildDoNext(base({ leads: [l] }), ctx);
    expect(r.items.map((i) => i.kind)).toEqual(["callback_overdue"]);
  });
});

describe("counts and filters", () => {
  const r = buildDoNext(
    base({
      leads: [lead({ id: "n", assignedAt: "2026-11-09T04:00:00.000Z" })],
      conversations: [conv()],
      tasks: [task()],
      applications: [app()],
    }),
    ctx,
  );
  it("counts per filter and hides nothing in All", () => {
    expect(r.counts).toEqual({ all: 4, calls: 1, messages: 1, documents: 1, tasks: 1 });
  });
  it("filterItems narrows", () => {
    expect(filterItems(r.items, "messages").map((i) => i.kind)).toEqual(["reply_waiting"]);
    expect(filterItems(r.items, "all")).toHaveLength(4);
  });
  it("bookedToday counts every call-back due on the tenant-local day, including ones already due", () => {
    const b = buildDoNext(
      base({ leads: [lead({ id: "a", lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-09T02:00:00.000Z" }), lead({ id: "b", lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-09T09:00:00.000Z" }), lead({ id: "c", lastTouchedAt: "2026-11-09T01:00:00.000Z", callbackDueAt: "2026-11-10T09:00:00.000Z" })] }),
      ctx,
    );
    expect(b.bookedToday).toBe(2);
  });
});

describe("agenda (Today card)", () => {
  it("timed call-backs and pending activities by time, then untimed tasks due today", () => {
    const a = buildAgenda(
      [lead({ name: "Nabin KC", callbackDueAt: "2026-11-09T05:45:00.000Z" })],
      [{ id: "s", activityType: "meeting", subject: "with her father", location: "Room 2", scheduledAt: "2026-11-09T08:15:00.000Z", leadName: "Pooja Shrestha" }],
      [task()],
      ctx,
    );
    expect(a.map((e) => [e.time, e.title])).toEqual([["11:30", "Call back · Nabin KC"], ["14:00", "Meeting · Pooja Shrestha"], [null, "Send SOP feedback"]]);
    expect(a[0].soon).toBe(false);
  });
});

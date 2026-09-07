import { describe, it, expect, vi, afterEach } from "vitest";
import { todayInTz, addDays } from "@/lib/hr/dates";
import { groupTasksByDue, summarizeOpenTasks } from "./task-grouping";

describe("groupTasksByDue", () => {
  it("buckets overdue, due-today, due-tomorrow, later, and dateless tasks", () => {
    const today = "2026-03-10";
    const tomorrow = "2026-03-11";
    const tasks = [
      { due_date: "2026-03-09" },
      { due_date: today },
      { due_date: tomorrow },
      { due_date: "2026-03-20" },
      { due_date: null },
    ];
    const groups = groupTasksByDue(tasks, today, tomorrow);
    expect(groups.overdue).toHaveLength(1);
    expect(groups.dueToday).toHaveLength(1);
    expect(groups.dueTomorrow).toHaveLength(1);
    expect(groups.later).toHaveLength(2); // "2026-03-20" + the dateless task
  });
});

// Regression for the Home "today is the browser's, not the tenant's" bug
// (feedback_date_tests_need_foreign_timezone): the dev/CI machine tz is
// Asia/Kathmandu, which is also the tenants.timezone default, so a bug that
// silently falls back to local/browser date passes here and only breaks on
// prod's UTC container. Both tests below pick a tenant tz that disagrees with
// Asia/Kathmandu at the same instant, in both directions (UTC- and UTC+
// relative to Kathmandu), and assert the "today" task is never Overdue.
describe("groupTasksByDue under a foreign tenant timezone", () => {
  afterEach(() => vi.useRealTimers());

  it("a UTC- tenant tz (America/New_York) 'today' groups Due Today, not Overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T04:00:00Z"));

    const tenantToday = todayInTz("America/New_York");
    const machineToday = todayInTz("Asia/Kathmandu");
    expect(tenantToday).not.toBe(machineToday); // sanity: the two tz's disagree at this instant

    const tomorrow = addDays(tenantToday, 1);
    const { overdue, dueToday } = groupTasksByDue([{ due_date: tenantToday }], tenantToday, tomorrow);
    expect(dueToday).toHaveLength(1);
    expect(overdue).toHaveLength(0);
  });

  it("a UTC+ tenant tz (Pacific/Auckland) 'today' groups Due Today, not Overdue", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));

    const tenantToday = todayInTz("Pacific/Auckland");
    const machineToday = todayInTz("Asia/Kathmandu");
    expect(tenantToday).not.toBe(machineToday); // sanity: the two tz's disagree at this instant

    const tomorrow = addDays(tenantToday, 1);
    const { overdue, dueToday } = groupTasksByDue([{ due_date: tenantToday }], tenantToday, tomorrow);
    expect(dueToday).toHaveLength(1);
    expect(overdue).toHaveLength(0);
  });
});

// Home Overview's TasksCard (docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md
// §Phase 2): a capped summary, not a third task surface — caps at 5, ordered
// soonest-first with nulls last, and reports the TRUE total (not just
// visible.length) for the "View all N" footer link.
describe("summarizeOpenTasks", () => {
  const today = "2026-03-10";
  const tomorrow = "2026-03-11";

  it("caps visible at max (default 5) but reports the true total", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => ({ id: String(i), due_date: null as string | null }));
    const { visible, total } = summarizeOpenTasks(tasks, today, tomorrow);
    expect(visible).toHaveLength(5);
    expect(total).toBe(8);
  });

  it("orders soonest due date first, with null due dates last", () => {
    const tasks = [
      { id: "no-date", due_date: null as string | null },
      { id: "later", due_date: "2026-03-20" },
      { id: "tomorrow", due_date: tomorrow },
      { id: "today", due_date: today },
      { id: "overdue", due_date: "2026-03-05" },
    ];
    const { visible } = summarizeOpenTasks(tasks, today, tomorrow, 10);
    expect(visible.map((t) => t.id)).toEqual(["overdue", "today", "tomorrow", "later", "no-date"]);
  });

  it("respects a custom max", () => {
    const tasks = [
      { id: "a", due_date: today },
      { id: "b", due_date: today },
      { id: "c", due_date: today },
    ];
    const { visible, total } = summarizeOpenTasks(tasks, today, tomorrow, 2);
    expect(visible).toHaveLength(2);
    expect(total).toBe(3);
  });

  it("total is 0 and visible is empty when there are no open tasks", () => {
    const { visible, total } = summarizeOpenTasks([], today, tomorrow);
    expect(visible).toEqual([]);
    expect(total).toBe(0);
  });
});

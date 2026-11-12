import { describe, it, expect, vi } from "vitest";
import { groupTasks, mergeTasks, sendToggle, taskCounts, toggleRequest } from "./tasks-merge";

const NOW = new Date(2026, 10, 12, 9, 0); // Thu 12 Nov 2026
const tasks = [
  { id: "t1", title: "Collect passport", status: "todo" as const, due_date: "2026-11-09", assignee_name: "Farhan" },
  { id: "t2", title: "Send shortlist", status: "todo" as const, due_date: "2026-11-14", assignee_name: null },
  { id: "t3", title: "Old done task", status: "done" as const, due_date: "2026-11-01", assignee_name: null },
  { id: "t4", title: "Far away", status: "in_progress" as const, due_date: "2026-12-30", assignee_name: null },
];
const checklists = [
  { id: "c1", title: "Book IELTS mock", is_completed: false },
  { id: "c2", title: "Verify transcript", is_completed: true },
];

describe("mergeTasks", () => {
  it("shows checklist items as undated tasks next to the real tasks", () => {
    const m = mergeTasks(tasks, checklists);
    expect(m).toHaveLength(6);
    const c1 = m.find((t) => t.key === "checklist-c1");
    expect(c1).toMatchObject({ source: "checklist", title: "Book IELTS mock", due_date: null, done: false, assignee_name: null });
    expect(m.find((t) => t.key === "checklist-c2")?.done).toBe(true);
    expect(m.find((t) => t.key === "task-t3")?.done).toBe(true);
  });

  it("counts Open and Done across both sources", () => {
    expect(taskCounts(mergeTasks(tasks, checklists))).toEqual({ open: 4, done: 2 });
  });

  it("an id in both tables does not collide (keys differ)", () => {
    const m = mergeTasks([{ id: "same", title: "a", status: "todo", due_date: null }], [{ id: "same", title: "b", is_completed: false }]);
    expect(new Set(m.map((t) => t.key)).size).toBe(2);
  });
});

describe("groupTasks", () => {
  it("Overdue / This week / Later / No date / Done, with dated groups ordered by due date", () => {
    const g = groupTasks(mergeTasks(tasks, checklists), NOW);
    expect(g.map((x) => x.id)).toEqual(["overdue", "week", "later", "none", "done"]);
    expect(g[0].items.map((t) => t.id)).toEqual(["t1"]);
    expect(g[1].items.map((t) => t.id)).toEqual(["t2"]);
    expect(g[3].items.map((t) => t.id)).toEqual(["c1"]); // the checklist item lands in "No date"
    expect(g[4].items.map((t) => t.key).sort()).toEqual(["checklist-c2", "task-t3"]);
  });

  it("leaves empty groups out", () => {
    expect(groupTasks([], NOW)).toEqual([]);
  });
});

describe("ticking calls the right endpoint", () => {
  it("a task goes to the task endpoint, done / reopened", () => {
    expect(toggleRequest({ id: "t1", source: "task" }, "L1", true)).toEqual({ url: "/api/v1/my-tasks/t1", body: { status: "done" } });
    expect(toggleRequest({ id: "t1", source: "task" }, "L1", false)).toEqual({ url: "/api/v1/my-tasks/t1", body: { status: "todo" } });
  });

  it("a checklist item goes to the checklist endpoint of its lead", () => {
    expect(toggleRequest({ id: "c1", source: "checklist" }, "L1", true)).toEqual({ url: "/api/v1/leads/L1/checklists/c1", body: { is_completed: true } });
  });

  it("sendToggle PATCHes that request and reports success / failure", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true });
    expect(await sendToggle({ id: "c1", source: "checklist" }, "L1", true, ok as unknown as typeof fetch)).toBe(true);
    expect(ok).toHaveBeenCalledWith("/api/v1/leads/L1/checklists/c1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ is_completed: true }) }));

    const bad = vi.fn().mockResolvedValue({ ok: false });
    expect(await sendToggle({ id: "t1", source: "task" }, "L1", true, bad as unknown as typeof fetch)).toBe(false);
    expect(bad).toHaveBeenCalledWith("/api/v1/my-tasks/t1", expect.objectContaining({ body: JSON.stringify({ status: "done" }) }));

    const boom = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await sendToggle({ id: "t1", source: "task" }, "L1", true, boom as unknown as typeof fetch)).toBe(false);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { mergeTasks } from "./lib/tasks-merge";
import { TasksTab } from "./tasks-tab";

afterEach(cleanup);

const items = mergeTasks(
  [
    { id: "t1", title: "Collect passport", status: "todo", due_date: "2020-01-01", assignee_name: "Farhan" },
    { id: "t2", title: "Old done task", status: "done", due_date: null },
  ],
  [{ id: "c1", title: "Book IELTS mock", is_completed: false }],
);

function setup(over: Partial<React.ComponentProps<typeof TasksTab>> = {}) {
  const onToggle = vi.fn();
  render(
    <TasksTab items={items} leadId="L1" currentUserId="u1" composerRef={createRef<HTMLInputElement>()} onToggle={onToggle} onOpen={() => {}} onCreated={() => {}} {...over} />,
  );
  return { onToggle };
}

describe("TasksTab", () => {
  it("one list: a checklist item shows next to tasks, under 'No date'", () => {
    setup();
    expect(screen.getByText("Collect passport")).toBeTruthy();
    expect(screen.getByText("Book IELTS mock")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("No date")).toBeTruthy();
    expect(screen.getByText(/old checklist items show here as tasks without a due date/)).toBeTruthy();
  });

  it("chips show Open and Done counts; Done switches to the done group with struck-through rows", () => {
    setup();
    expect(screen.getByRole("button", { name: /^Open/ }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /^Done/ }).textContent).toContain("1");
    fireEvent.click(screen.getByRole("button", { name: /^Done/ }));
    expect(screen.queryByText("Collect passport")).toBeNull();
    expect(screen.getByText("Old done task").className).toContain("line-through");
    expect(screen.getByText("Old done task").className).toContain("opacity-50");
  });

  it("ticking a checklist row hands back a checklist-source item; ticking a task hands back a task-source item", () => {
    const { onToggle } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Book IELTS mock" }));
    expect(onToggle).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1", source: "checklist" }), true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Collect passport" }));
    expect(onToggle).toHaveBeenLastCalledWith(expect.objectContaining({ id: "t1", source: "task" }), true);
  });

  it("has the composer on top (placeholder 'Add a task…')", () => {
    setup();
    expect(screen.getByPlaceholderText("Add a task…")).toBeTruthy();
  });

  it("empty: an Attio-style empty state with one primary button", () => {
    setup({ items: [] });
    expect(screen.getByText("No open tasks")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Add a task" }).length).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TasksSection } from "./tasks-section";

const noop = () => {};
afterEach(cleanup);

describe("TasksSection", () => {
  it("0 open tasks: header, a 0 chip and the + button, and no box under it", () => {
    const { container } = render(<TasksSection count={0} items={[]} onAdd={noop} onComplete={noop} onOpen={noop} />);
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByLabelText("Add task")).toBeTruthy();
    expect(container.querySelector(".shadow-\\[inset_0_0_0_1px_\\#eeeff1\\]")).toBeNull();
  });

  it("with tasks: the box and a row per task", () => {
    const { container } = render(<TasksSection count={2} items={[{ id: "a", title: "Call", due_date: null }, { id: "b", title: "Email", due_date: null }]} onAdd={noop} onComplete={noop} onOpen={noop} />);
    expect(screen.getByText("Call")).toBeTruthy();
    expect(screen.getByLabelText("Complete Email")).toBeTruthy();
    expect(container.querySelector(".shadow-\\[inset_0_0_0_1px_\\#eeeff1\\]")).not.toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { TaskList } from "./task-list";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const task = { id: "t1", title: "Call student", status: "open", priority: "normal", due_date: null };

function setup(patchOk: boolean) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { ok: patchOk, json: async () => ({}) };
    return { ok: true, json: async () => ({ data: [task] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const onChange = vi.fn();
  render(<TaskList fetchUrl="/api/v1/leads/l1/tasks" currentUserId="u1" context={{ leadId: "l1" }} onChange={onChange} />);
  return { fetchMock, onChange };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("TaskList onChange", () => {
  it("fires once after a successful complete", async () => {
    const { fetchMock, onChange } = setup(true);
    fireEvent.click(await screen.findByTitle("Mark done"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true);
  });

  it("does not fire when the PATCH fails", async () => {
    const { fetchMock, onChange } = setup(false);
    fireEvent.click(await screen.findByTitle("Mark done"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(onChange).not.toHaveBeenCalled();
  });
});

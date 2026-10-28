// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { toast } from "sonner";
import { SavedFiltersMenu } from "./saved-filters-menu";
import { leadFields } from "@/lib/filters/registry/leads";
import { EMPTY_TREE, type CompileCtx, type FilterTree } from "@/lib/filters/types";

const registry = leadFields({ tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} } as CompileCtx);

const SAVED_TREE: FilterTree = {
  conjunction: "and",
  conditions: [
    { id: "old-1", field: "assignees", op: "is_any_of", value: ["u1"] },
    { id: "old-2", field: "status", op: "is_any_of", value: ["connected", "in_progress"] },
  ],
};
const LIST = [{ id: "f-1", name: "Amit — Prospects", filter_tree: SAVED_TREE, created_at: "t" }];
const CURRENT: FilterTree = { conjunction: "and", conditions: [{ id: "c1", field: "status", op: "is", value: "connected" }] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      return { ok: true, status: 201, json: async () => ({ data: { id: "f-2", name: body.name, filter_tree: body.filter_tree, created_at: "t" } }) };
    }
    if (init?.method === "DELETE") return { ok: true, status: 200, json: async () => ({ data: { id: "f-1", deleted: true } }) };
    return { ok: true, status: 200, json: async () => ({ data: LIST }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(tree: FilterTree = CURRENT) {
  const onApply = vi.fn();
  render(<SavedFiltersMenu tree={tree} registry={registry} onApply={onApply} />);
  fireEvent.click(screen.getByRole("button", { name: /Saved filters/ }));
  return { onApply };
}

describe("SavedFiltersMenu", () => {
  it("loads and lists the user's saved filters when opened", async () => {
    setup();
    expect(await screen.findByText("Amit — Prospects")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/saved-lead-filters");
  });

  it("one click applies a saved filter with fresh condition ids, then closes", async () => {
    const { onApply } = setup();
    fireEvent.click(await screen.findByText("Amit — Prospects"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const applied = onApply.mock.calls[0][0] as FilterTree;
    expect(applied.conditions.map((c) => c.field)).toEqual(["assignees", "status"]);
    expect(applied.conditions.map((c) => c.id)).not.toContain("old-1");
    await waitFor(() => expect(screen.queryByText("Save current filter")).toBeNull());
  });

  it("saves the filter currently on the bar under the typed name", async () => {
    setup();
    await screen.findByText("Amit — Prospects");
    fireEvent.change(screen.getByPlaceholderText(/Name, e\.g\./), { target: { value: "Connected only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.name).toBe("Connected only");
      expect(body.filter_tree).toEqual(CURRENT);
    });
    expect(await screen.findByText("Connected only")).toBeInTheDocument();
  });

  it("cannot save when no filter is set — the name box is disabled and says so", async () => {
    setup(EMPTY_TREE);
    await screen.findByText("Amit — Prospects");
    const input = screen.getByPlaceholderText("Add a filter first");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save filter" })).toBeDisabled();
  });

  it("shows the server's message when saving fails (e.g. duplicate name)", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? { ok: false, status: 409, json: async () => ({ error: { code: "CONFLICT", message: "You already have a saved filter with that name." } }) }
        : { ok: true, status: 200, json: async () => ({ data: LIST }) },
    );
    setup();
    await screen.findByText("Amit — Prospects");
    fireEvent.change(screen.getByPlaceholderText(/Name, e\.g\./), { target: { value: "Amit — Prospects" } });
    fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You already have a saved filter with that name."));
  });

  it("deleting asks first, then removes it", async () => {
    setup();
    await screen.findByText("Amit — Prospects");
    fireEvent.click(screen.getByRole("button", { name: "Delete saved filter Amit — Prospects" }));
    expect(await screen.findByText(/Delete “Amit — Prospects”\?/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Amit — Prospects")).toBeNull());
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "DELETE");
    expect(del![0]).toBe("/api/v1/saved-lead-filters/f-1");
  });

  it("refuses a saved filter whose fields no longer exist, without changing the bar", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "f-9", name: "Old", filter_tree: { conjunction: "and", conditions: [{ id: "x", field: "gone", op: "is", value: "1" }] }, created_at: "t" }] }),
    }));
    const { onApply } = setup();
    fireEvent.click(await screen.findByText("Old"));
    expect(onApply).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("This saved filter no longer applies to your leads.");
  });
});

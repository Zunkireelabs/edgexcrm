// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { usePreviewData, useTaskChangedRefresh } from "./use-preview-data";
import { notifyTaskChanged } from "@/lib/tasks/task-events";

const payload = (n: number) => ({ data: { tasks: { open_count: n, items: [] }, activity: [] } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("preview refreshes on task changes", () => {
  it("TASK_CHANGED_EVENT refetches the preview payload", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload(n) }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => {
      const p = usePreviewData("lead-1", null, "top");
      useTaskChangedRefresh("lead-1", p.invalidate);
      return p;
    });
    await waitFor(() => expect(result.current.data?.tasks.open_count).toBe(0));
    const before = fetchMock.mock.calls.length;
    n = 1;
    act(() => notifyTaskChanged());
    await waitFor(() => expect(result.current.data?.tasks.open_count).toBe(1));
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });
});

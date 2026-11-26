// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { useLeadSourceOptions } from "./use-lead-source-options";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  toastError.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("useLeadSourceOptions", () => {
  it("has the built-in lists straight away, and does not call the server when not enabled", () => {
    const { result } = renderHook(() => useLeadSourceOptions(false));
    expect(result.current.lists.category.map((o) => o.value)).toContain("google");
    expect(result.current.lists.channel.map((o) => o.value)).toContain("check_in");
    expect(result.current.lists.account).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swaps in the tenant's lists (with what an admin added) once loaded", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: {
      category: [{ value: "google", label: "Google" }],
      channel: [{ value: "check_in", label: "Check-in" }],
      account: [{ value: "admizz_facebook", label: "Admizz Facebook" }],
    } }));
    const { result } = renderHook(() => useLeadSourceOptions(true));
    await waitFor(() => expect(result.current.lists.account).toEqual([{ value: "admizz_facebook", label: "Admizz Facebook" }]));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/lead-source-options");
  });

  it("keeps the built-in lists when the request fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useLeadSourceOptions(true));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.lists.category.length).toBeGreaterThan(0);
  });

  it("adds an option: posts it, shows it in the list, and returns its stored value", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: {} })); // initial load
    const { result } = renderHook(() => useLeadSourceOptions(true));
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockResolvedValueOnce(json(201, { data: { kind: "account", value: "tiktok", label: "TikTok", created: true } }));
    let picked: string | null = null;
    await act(async () => { picked = await result.current.addOption("account", "TikTok"); });
    expect(picked).toBe("tiktok");
    expect(result.current.lists.account).toEqual([{ value: "tiktok", label: "TikTok" }]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/lead-source-options", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "account", label: "TikTok" }) }));
  });

  it("a refused add (for example not an admin) returns null, shows the reason, and changes nothing", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: {} }));
    const { result } = renderHook(() => useLeadSourceOptions(true));
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockResolvedValueOnce(json(403, { error: { message: "Insufficient permissions" } }));
    let picked: string | null = "x";
    await act(async () => { picked = await result.current.addOption("channel", "Radio"); });
    expect(picked).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Insufficient permissions");
    expect(result.current.lists.channel.map((o) => o.value)).not.toContain("radio");
  });
});

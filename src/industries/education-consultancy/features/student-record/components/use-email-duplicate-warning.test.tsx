// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { emailWarningText, useEmailDuplicateWarning } from "./use-email-duplicate-warning";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

describe("emailWarningText", () => {
  it("nothing when there is no duplicate", () => {
    expect(emailWarningText(null)).toBeNull();
    expect(emailWarningText({ duplicate: false, count: 0 })).toBeNull();
  });
  it("a counsellor (count only) is told one exists, with no details", () => {
    expect(emailWarningText({ duplicate: true, count: 1 })).toBe("Another lead already has this email.");
    expect(emailWarningText({ duplicate: true, count: 3 })).toBe("3 other leads already have this email.");
  });
  it("an admin sees which lead", () => {
    expect(emailWarningText({ duplicate: true, count: 1, leads: [{ id: "a", display_id: "ADM-17703", name: "Laxmi Bantha" }] }))
      .toBe("Another lead already has this email: ADM-17703 · Laxmi Bantha.");
    expect(emailWarningText({ duplicate: true, count: 5, leads: [1, 2, 3, 4, 5].map((n) => ({ id: `${n}`, display_id: `ADM-${n}`, name: null })) }))
      .toBe("Other leads already have this email: ADM-1, ADM-2, ADM-3 and 2 more.");
  });
});

describe("useEmailDuplicateWarning", () => {
  it("asks the server and keeps the warning to show", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { duplicate: true, count: 1 } }));
    const { result } = renderHook(() => useEmailDuplicateWarning("lead-1"));
    await act(async () => { await result.current.check(" New@Example.com ", "old@example.com"); });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/leads/lead-1/email-check?email=New%40Example.com");
    expect(result.current.message).toBe("Another lead already has this email.");
  });

  it("does not ask when the email is empty, malformed, or unchanged (ignoring case and spaces)", async () => {
    const { result } = renderHook(() => useEmailDuplicateWarning("lead-1"));
    for (const e of ["", "  ", "nope", " OLD@example.com "]) await act(async () => { await result.current.check(e, "old@example.com"); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.message).toBeNull();
  });

  it("no duplicate: no warning", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { duplicate: false, count: 0 } }));
    const { result } = renderHook(() => useEmailDuplicateWarning("lead-1"));
    await act(async () => { await result.current.check("free@example.com", ""); });
    expect(result.current.message).toBeNull();
  });

  it("a failed request or a refusal shows nothing (the warning is only a nicety)", async () => {
    const { result } = renderHook(() => useEmailDuplicateWarning("lead-1"));
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await result.current.check("a@example.com", ""); });
    expect(result.current.message).toBeNull();
    fetchMock.mockResolvedValueOnce(json({ error: {} }, false));
    await act(async () => { await result.current.check("a@example.com", ""); });
    expect(result.current.message).toBeNull();
  });

  it("typing again clears the warning, and an answer that arrives late is ignored", async () => {
    let release: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useEmailDuplicateWarning("lead-1"));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.check("a@example.com", ""); });
    act(() => result.current.clear()); // the person kept typing
    await act(async () => { release(json({ data: { duplicate: true, count: 1 } })); await pending; });
    await waitFor(() => expect(result.current.message).toBeNull());
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  LEAD_NAV_KEY, readLeadNav, writeLeadNav, resolveLeadNav, nextLeadAfterHandOff, fetchAdjacentLeadId, type LeadNavContext,
} from "./lead-nav";

const ctx: LeadNavContext = { viewLabel: "All leads", href: "/leads?search=a", query: { search: "a" }, page: 2, pageSize: 3, ids: ["a", "b", "c"], total: 9 };

describe("edgex.leadNav storage", () => {
  it("round-trips through a storage object", () => {
    const mem = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void mem.set(k, v), getItem: (k: string) => mem.get(k) ?? null };
    writeLeadNav(ctx, storage);
    expect(mem.has(LEAD_NAV_KEY)).toBe(true);
    expect(readLeadNav(storage)).toEqual(ctx);
  });
  it("swallows storage errors on write and read", () => {
    const boom = () => { throw new Error("blocked"); };
    expect(() => writeLeadNav(ctx, { setItem: boom })).not.toThrow();
    expect(readLeadNav({ getItem: boom })).toBeNull();
  });
  it("treats junk or a wrong shape as no context", () => {
    expect(readLeadNav({ getItem: () => "not json" })).toBeNull();
    expect(readLeadNav({ getItem: () => JSON.stringify({ ids: "x" }) })).toBeNull();
    expect(readLeadNav({ getItem: () => null })).toBeNull();
  });
});

describe("resolveLeadNav", () => {
  it("hides everything for a stale or missing context (lead not in ids)", () => {
    expect(resolveLeadNav(null, "a")).toBeNull();
    expect(resolveLeadNav(ctx, "zzz")).toBeNull();
  });
  it("gives position, counter and neighbours inside the page", () => {
    const r = resolveLeadNav(ctx, "b")!;
    expect(r).toMatchObject({ position: 5, total: 9, viewLabel: "All leads", backHref: "/leads?search=a", prevId: "a", nextId: "c", hasPrev: true, hasNext: true });
  });
  it("flags a neighbour on the adjacent page with a null id", () => {
    expect(resolveLeadNav(ctx, "c")).toMatchObject({ hasNext: true, nextId: null });
    expect(resolveLeadNav(ctx, "a")).toMatchObject({ hasPrev: true, prevId: null });
  });
  it("has no prev on the very first row and no next on the very last", () => {
    expect(resolveLeadNav({ ...ctx, page: 1 }, "a")).toMatchObject({ hasPrev: false, position: 1 });
    expect(resolveLeadNav({ ...ctx, page: 3 }, "c")).toMatchObject({ hasNext: false, position: 9 });
  });
});

describe("fetchAdjacentLeadId", () => {
  it("fetches the next page with the view's query and lands on its first row", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "d" }, { id: "e" }] }) });
    const r = await fetchAdjacentLeadId(ctx, "next", fetcher as unknown as typeof fetch);
    expect(r?.id).toBe("d");
    expect(r?.ctx.page).toBe(3);
    const url = String(fetcher.mock.calls[0][0]);
    expect(url).toContain("search=a");
    expect(url).toContain("page=3");
    expect(url).toContain("pageSize=3");
  });
  it("lands on the last row of the previous page", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "x" }, { id: "y" }] }) });
    expect((await fetchAdjacentLeadId(ctx, "prev", fetcher as unknown as typeof fetch))?.id).toBe("y");
  });
  it("returns null on failure or an empty page", async () => {
    expect(await fetchAdjacentLeadId(ctx, "next", vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchAdjacentLeadId(ctx, "next", vi.fn().mockRejectedValue(new Error("x")) as unknown as typeof fetch)).toBeNull();
    expect(await fetchAdjacentLeadId({ ...ctx, page: 1 }, "prev", vi.fn() as unknown as typeof fetch)).toBeNull();
  });
});

describe("hand-off: which lead opens next", () => {
  it("opens the next lead of the view", () => expect(nextLeadAfterHandOff(ctx, "a")).toBe("b"));
  it("falls back to the previous when this was the last on the page", () => expect(nextLeadAfterHandOff({ ...ctx, page: 3 }, "c")).toBe("b"));
  it("is null with no context, so the page goes back to the view", () => expect(nextLeadAfterHandOff(null, "a")).toBeNull());
});

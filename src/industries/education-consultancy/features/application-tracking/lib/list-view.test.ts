// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { gridPrefsKey } from "@/components/dashboard/leads/table/grid-prefs";
import {
  BULK_CONCURRENCY,
  LIST_DEFAULT_KEYS,
  LIST_PREFS_SCOPE,
  bulkToast,
  headerCheckState,
  loadListLayout,
  loadPageSize,
  pageSizeKey,
  pageWindow,
  parsePage,
  parsePageSize,
  resetListLayout,
  runBulkPatch,
  saveListLayout,
  savePageSize,
  toggleId,
  togglePage,
} from "./list-view";

beforeEach(() => localStorage.clear());

describe("paging", () => {
  it("page window clamps and tiles: 72 apps at 25 -> 3 pages (25, 25, 22)", () => {
    expect(pageWindow(1, 25, 72)).toEqual({ page: 1, totalPages: 3, offset: 0, start: 0, end: 25 });
    expect(pageWindow(3, 25, 72)).toEqual({ page: 3, totalPages: 3, offset: 50, start: 50, end: 72 });
    expect(pageWindow(9, 25, 72).page).toBe(3); // past the end -> last page
    expect(pageWindow(0, 25, 72).page).toBe(1);
    expect(pageWindow(1, 100, 72)).toMatchObject({ totalPages: 1, end: 72 });
    expect(pageWindow(1, 25, 0)).toEqual({ page: 1, totalPages: 1, offset: 0, start: 0, end: 0 });
  });
  it("?page= parsing", () => {
    expect(parsePage("2")).toBe(2);
    for (const bad of [null, undefined, "", "0", "-1", "1.5", "abc"]) expect(parsePage(bad)).toBe(1);
  });
  it("page size: 25/50/100 only, remembered per tenant + user", () => {
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("10")).toBe(25);
    expect(parsePageSize(null)).toBe(25);
    savePageSize("t", "u1", 100);
    expect(loadPageSize("t", "u1")).toBe(100);
    expect(loadPageSize("t", "u2")).toBe(25);
    localStorage.setItem(pageSizeKey("t", "u3"), "999");
    expect(loadPageSize("t", "u3")).toBe(25);
  });
});

describe("column layout prefs (Leads grid-prefs mechanism, own key)", () => {
  it("defaults, save + load, reset; stored under the applications-list scope, never the Leads key", () => {
    expect(loadListLayout("t", "u").keys).toEqual(LIST_DEFAULT_KEYS);
    saveListLayout("t", "u", { keys: ["stage", "university", "country"], pins: [] });
    expect(localStorage.getItem(gridPrefsKey("t", "u", LIST_PREFS_SCOPE))).toContain("country");
    expect(localStorage.getItem(gridPrefsKey("t", "u"))).toBeNull();
    expect(loadListLayout("t", "u").keys).toEqual(["stage", "university", "country"]);
    expect(resetListLayout("t", "u").keys).toEqual(LIST_DEFAULT_KEYS);
    expect(loadListLayout("t", "u").keys).toEqual(LIST_DEFAULT_KEYS);
  });
  it("unknown keys from an old record are dropped; pins never survive", () => {
    localStorage.setItem(gridPrefsKey("t", "u", LIST_PREFS_SCOPE), JSON.stringify({ v: 1, keys: ["bogus", "docs"], pins: ["docs"], labels: {}, widths: {} }));
    expect(loadListLayout("t", "u")).toEqual({ keys: ["docs"], pins: [] });
  });
});

describe("selection: the header checkbox works on the current page only", () => {
  it("toggle one, select page, clear page, header state", () => {
    let sel = toggleId(new Set(), "a");
    expect([...sel]).toEqual(["a"]);
    expect(headerCheckState(sel, ["a", "b"])).toBe("indeterminate");
    sel = togglePage(sel, ["a", "b"]);
    expect([...sel].sort()).toEqual(["a", "b"]);
    expect(headerCheckState(sel, ["a", "b"])).toBe(true);
    expect([...togglePage(sel, ["a", "b"])]).toEqual([]);
    expect(headerCheckState(new Set(), ["a"])).toBe(false);
    // another page's ids are never added by the header box
    expect([...togglePage(new Set(["x"]), ["a"])]).toEqual(["a"]);
  });
});

describe("runBulkPatch", () => {
  it("never more than 5 in flight; partial failure keeps the failed ids (in order) and reports N of M", async () => {
    let inFlight = 0;
    let peak = 0;
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
      if (url.endsWith("/a3")) throw new Error("network");
      return { ok: !url.endsWith("/a7") } as Response;
    }) as unknown as typeof fetch;
    const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
    const res = await runBulkPatch(ids, { stage_id: "s2" }, fake);
    expect(peak).toBeLessThanOrEqual(BULK_CONCURRENCY);
    expect(peak).toBe(5);
    expect(res.failed).toEqual(["a3", "a7"]);
    expect(res.ok).toHaveLength(10);
    expect(calls).toHaveLength(12);
    expect(calls[0].init).toMatchObject({ method: "PATCH", body: JSON.stringify({ stage_id: "s2" }) });
    expect(calls[0].url).toBe("/api/v1/applications/a0");
    expect(bulkToast(res, "moved")).toEqual({ tone: "error", text: "10 of 12 updated" });
  });
  it("all ok -> success toast; one id; empty list", async () => {
    const ok = (async () => ({ ok: true }) as Response) as unknown as typeof fetch;
    expect(bulkToast(await runBulkPatch(["a"], { assigned_to: null }, ok), "updated")).toEqual({ tone: "success", text: "1 application updated" });
    expect(bulkToast(await runBulkPatch(["a", "b"], {}, ok), "moved").text).toBe("2 applications moved");
    expect(await runBulkPatch([], {}, ok)).toEqual({ ok: [], failed: [] });
  });
});

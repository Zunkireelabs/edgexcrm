import { describe, it, expect } from "vitest";
import { coveredMean, coveredUsualIndices, firstAtFor, previousCovered } from "./coverage";

const DAY = 86_400_000;
const now = new Date("2026-11-05T12:00:00Z").getTime();
const win30 = { windowFrom: new Date(now - 30 * DAY), lenMs: 30 * DAY };
const win7 = { windowFrom: new Date(now - 7 * DAY), lenMs: 7 * DAY };
const ago = (d: number) => new Date(now - d * DAY);

describe("coverage-aware usual", () => {
  it("a tenant with 34 days of history at 30d: no covered prior window → no usual at all", () => {
    const idx = coveredUsualIndices(win30, ago(34));
    expect(idx).toEqual([]);
    expect(coveredMean(() => 100, idx)).toBeNull();
    expect(previousCovered(win30, ago(34))).toBe(false);
  });
  it("at 7d a tenant with 36 days of history has all 4 prior windows covered", () => {
    expect(coveredUsualIndices(win7, ago(36))).toEqual([0, 1, 2, 3]);
    expect(coveredUsualIndices(win7, ago(34))).toEqual([0, 1, 2]);
    expect(previousCovered(win7, ago(34))).toBe(true);
  });
  it("a new hire with 1 covered window has no usual (needs 2)", () => {
    const idx = coveredUsualIndices(win7, ago(15)); // joined 15 days ago: only the week right before is covered
    expect(idx).toEqual([0]);
    expect(coveredMean(() => 10, idx)).toBeNull();
  });
  it("2 covered windows is enough, and the mean uses ONLY those windows (no zeros for the empty ones)", () => {
    const idx = coveredUsualIndices(win7, ago(21));
    expect(idx).toEqual([0, 1]);
    expect(coveredMean((i) => [10, 20, 0, 0][i], idx)).toBe(15);
  });
  it("a person's join date later than the tenant's first record narrows coverage", () => {
    const first = firstAtFor(ago(100), ago(15).toISOString());
    expect(coveredUsualIndices(win7, first)).toEqual([0]);
    expect(firstAtFor(ago(10), ago(50).toISOString())?.getTime()).toBe(ago(10).getTime());
    expect(firstAtFor(null, ago(5).toISOString())).toBeNull();
  });
});

describe("firstAtFor — earliest of first activity and join date, bounded by the tenant's start", () => {
  it("(a) activity before the join date → coverage from the first activity", () => {
    expect(firstAtFor(ago(100), ago(2).toISOString(), ago(40).toISOString())?.getTime()).toBe(ago(40).getTime());
    expect(coveredUsualIndices(win7, firstAtFor(ago(100), ago(2).toISOString(), ago(40).toISOString()))).toEqual([0, 1, 2, 3]);
  });
  it("(b) join before activity → from the join date (their quiet first weeks count)", () => {
    expect(firstAtFor(ago(100), ago(30).toISOString(), ago(10).toISOString())?.getTime()).toBe(ago(30).getTime());
  });
  it("never earlier than the tenant's first record", () => {
    expect(firstAtFor(ago(20), ago(90).toISOString(), ago(60).toISOString())?.getTime()).toBe(ago(20).getTime());
  });
  it("no join date and no activity → the tenant's start; no tenant data → null", () => {
    expect(firstAtFor(ago(20), null, null)?.getTime()).toBe(ago(20).getTime());
    expect(firstAtFor(null, ago(5).toISOString(), ago(9).toISOString())).toBeNull();
  });
});

describe("aligned (Today) coverage uses the explicit span starts", () => {
  it("a weekday span before the data starts is not covered, even if the contiguous arithmetic would say so", () => {
    const c = { windowFrom: ago(0), lenMs: 6 * 3600_000, tenantFirst: ago(16), usualFroms: [ago(7), ago(14), ago(21), ago(28)], previousFrom: ago(1) };
    expect(coveredUsualIndices(c, ago(16))).toEqual([0, 1]);
    expect(previousCovered(c, ago(16))).toBe(true);
    expect(previousCovered({ ...c, previousFrom: ago(20) }, ago(16))).toBe(false);
  });
});

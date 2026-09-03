import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { resolveMatchedFilter, buildDateRangeFilter } from "./route";
import { dayBoundsInTz } from "@/lib/filters/compile";

// buildIlikeOrFilter is deliberately NOT mocked — the GET suite below proves the
// real sanitiser is wired in so `q=%` can't return the whole form's submissions.
vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "u-1",
    email: "a@b.c",
    tenantId: "tenant-A",
    role: "admin",
    industryId: "education_consultancy",
  })),
  requireAdmin: () => true,
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({ from: fromMock, raw: () => ({ from: fromMock }) })),
}));

describe("resolveMatchedFilter", () => {
  it('"new" maps to false', () => {
    expect(resolveMatchedFilter("new")).toBe(false);
  });

  it('"existing" maps to true', () => {
    expect(resolveMatchedFilter("existing")).toBe(true);
  });

  it("null (no param) maps to undefined — no filter applied", () => {
    expect(resolveMatchedFilter(null)).toBeUndefined();
  });

  it("an unrecognized value maps to undefined — no filter applied", () => {
    expect(resolveMatchedFilter("bogus")).toBeUndefined();
  });
});

describe("buildDateRangeFilter", () => {
  it("from=X & to=X in Asia/Kathmandu includes a submission created midday on X", () => {
    const tz = "Asia/Kathmandu";
    const { gte, lt } = buildDateRangeFilter("2026-08-29", "2026-08-29", tz);
    // A submission created at local noon on 2026-08-29 must fall inside [gte, lt).
    const middayLocal = new Date(dayBoundsInTz("2026-08-29", tz).start);
    middayLocal.setUTCHours(middayLocal.getUTCHours() + 12);
    const created = middayLocal.toISOString();

    expect(gte).toBeDefined();
    expect(lt).toBeDefined();
    expect(created >= gte!).toBe(true);
    expect(created < lt!).toBe(true);
  });

  it("to is an exclusive upper bound at the NEXT day's local midnight, not <= the given date", () => {
    const tz = "Asia/Kathmandu";
    const { lt } = buildDateRangeFilter(null, "2026-08-29", tz);
    // A submission created at local midnight on 2026-08-30 (the day AFTER `to`)
    // must be excluded — i.e. NOT < lt.
    const nextDayLocalMidnight = dayBoundsInTz("2026-08-30", tz).start;
    expect(nextDayLocalMidnight < lt!).toBe(false);
    // But the last instant of 2026-08-29 itself must be included.
    const endOf29 = dayBoundsInTz("2026-08-29", tz).end;
    expect(endOf29 <= lt!).toBe(true);
  });

  it("omitting from/to omits the corresponding bound entirely", () => {
    expect(buildDateRangeFilter(null, null, "UTC")).toEqual({});
    expect(buildDateRangeFilter("2026-08-29", null, "UTC").lt).toBeUndefined();
    expect(buildDateRangeFilter(null, "2026-08-29", "UTC").gte).toBeUndefined();
  });

  it("respects DST-style offset differences between timezones for the same date string", () => {
    const utc = buildDateRangeFilter("2026-08-29", "2026-08-29", "UTC");
    const kathmandu = buildDateRangeFilter("2026-08-29", "2026-08-29", "Asia/Kathmandu");
    expect(utc.gte).not.toBe(kathmandu.gte);
  });
});

// --- route-level: search sanitisation --------------------------------

type Call = [method: string, args: unknown[]];
const SUB_ROWS = Array.from({ length: 10 }, (_, i) => ({ id: `s-${i}`, lead_id: null }));

function makeChain(table: string, calls: Call[]) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([`${table}.${method}`, args]);
      return chain;
    };
  const chain: Record<string, unknown> = {
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    or: record("or"),
    gte: record("gte"),
    lt: record("lt"),
    in: async (...args: unknown[]) => {
      calls.push([`${table}.in`, args]);
      return { data: [], error: null };
    },
    maybeSingle: async () => ({ data: { id: "form-1" }, error: null }),
    order: (...args: unknown[]) => {
      calls.push([`${table}.order`, args]);
      return chain;
    },
    range: async (...args: unknown[]) => {
      calls.push([`${table}.range`, args]);
      return { data: SUB_ROWS, error: null, count: SUB_ROWS.length };
    },
  };
  return chain;
}

function fakeSubReq(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return { url: `http://localhost/api/v1/form-configs/form-1/submissions?${qs}` } as unknown as NextRequest;
}

describe("GET /api/v1/form-configs/[id]/submissions — search sanitisation", () => {
  let calls: Call[];
  let GET: typeof import("./route").GET;

  beforeEach(async () => {
    calls = [];
    fromMock.mockImplementation((table: string) => makeChain(table, calls));
    GET = (await import("./route")).GET;
  });

  const params = Promise.resolve({ id: "form-1" });
  const orArgs = () =>
    calls.filter(([m]) => m === "lead_submissions.or").map(([, a]) => a[0] as string);

  it("a normal search builds a quoted 4-column ilike group", async () => {
    await GET(fakeSubReq({ q: "chen" }), { params });
    expect(orArgs()).toEqual([
      'first_name.ilike."%chen%",last_name.ilike."%chen%",email.ilike."%chen%",phone.ilike."%chen%"',
    ]);
  });

  it("REGRESSION: match-all q=% returns an empty page, never the whole form", async () => {
    const res = await GET(fakeSubReq({ q: "%" }), { params });
    expect(orArgs()).toHaveLength(0);
    // no lead_submissions query was even issued
    expect(calls.some(([m]) => m.startsWith("lead_submissions."))).toBe(false);
    const body = await (res as Response).json();
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it("REGRESSION: match-all q=% CSV export returns a header-only file", async () => {
    const res = await GET(fakeSubReq({ q: "%", format: "csv" }), { params });
    const text = await (res as Response).text();
    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("First Name");
  });

  it("REGRESSION: crafted q cannot widen beyond the 4 intended fields", async () => {
    await GET(fakeSubReq({ q: "zzz,matched_existing.is.true,first_name.ilike.%" }), { params });
    const or = orArgs();
    expect(or).toHaveLength(1);
    const segments = or[0].match(/(?:^|,)[a-z_]+\.ilike\."(?:[^"\\]|\\.)*"/g) ?? [];
    expect(segments.join("")).toBe(or[0]);
  });
});

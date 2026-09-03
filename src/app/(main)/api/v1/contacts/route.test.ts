import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// --- mocks -----------------------------------------------------------
//
// buildIlikeOrFilter is deliberately NOT mocked — this suite proves the real
// sanitiser is wired into GET so a `q=%` match-all can't pull the whole tenant
// and a crafted `q` can't be parsed as PostgREST expression syntax.

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "u-1",
    email: "a@b.c",
    tenantId: "tenant-A",
    role: "admin",
    industryId: "it_agency",
  })),
  requireAdmin: () => true,
}));

vi.mock("@/industries/_loader", () => ({
  getFeatureAccess: () => true,
}));

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({ from: fromMock })),
}));

vi.mock("@/lib/api/audit", () => ({
  createAuditLog: vi.fn(),
  emitEvent: vi.fn(),
}));

import { GET } from "./route";

type Call = [method: string, args: unknown[]];

const ROWS = Array.from({ length: 10 }, (_, i) => ({ id: `c-${i}` }));

function makeChain(calls: Call[]) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  const chain: Record<string, unknown> = {
    select: record("select"),
    eq: record("eq"),
    is: record("is"),
    or: record("or"),
    order: (...args: unknown[]) => {
      calls.push(["order", args]);
      // second .order() call is awaited by the route
      return {
        ...chain,
        then: (resolve: (v: unknown) => void) => resolve({ data: ROWS, error: null }),
      };
    },
  };
  return chain;
}

function fakeReq(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return { url: `http://localhost/api/v1/contacts?${qs}` } as unknown as NextRequest;
}

let calls: Call[];
beforeEach(() => {
  calls = [];
  fromMock.mockReturnValue(makeChain(calls));
});

function orArgs() {
  return calls.filter(([m]) => m === "or").map(([, a]) => a[0] as string);
}

describe("GET /api/v1/contacts — search sanitisation", () => {
  it("a normal search builds a quoted 4-column ilike group", async () => {
    await GET(fakeReq({ q: "chen" }));
    expect(orArgs()).toEqual([
      'first_name.ilike."%chen%",last_name.ilike."%chen%",email.ilike."%chen%",title.ilike."%chen%"',
    ]);
  });

  it("REGRESSION: match-all q=% returns an empty list, not the whole tenant", async () => {
    const res = await GET(fakeReq({ q: "%" }));
    expect(orArgs()).toHaveLength(0);
    const body = await (res as Response).json();
    expect(body.data).toEqual([]);
  });

  it("REGRESSION: crafted q cannot widen beyond the 4 intended fields", async () => {
    await GET(fakeReq({ q: "zzz,status.eq.inactive,first_name.ilike.%" }));
    const or = orArgs();
    expect(or).toHaveLength(1);
    // injected predicate is trapped as literal text inside a quoted value
    const segments = or[0].match(/(?:^|,)[a-z_]+\.ilike\."(?:[^"\\]|\\.)*"/g) ?? [];
    expect(segments.join("")).toBe(or[0]);
    expect(new Set(segments.map((s) => s.replace(/^,/, "").split(".")[0]))).toEqual(
      new Set(["first_name", "last_name", "email", "title"]),
    );
  });
});

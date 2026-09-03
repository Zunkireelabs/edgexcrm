import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// --- mocks -----------------------------------------------------------
//
// The search-filter helper is deliberately NOT mocked — this suite proves the
// real sanitiser is wired into GET so a crafted `search` can't be parsed as
// PostgREST expression syntax (the injection this route shipped with).

const { gateIntegrationRequestMock } = vi.hoisted(() => ({
  gateIntegrationRequestMock: vi.fn(),
}));

vi.mock("@/lib/api/integration-helpers", () => ({
  gateIntegrationRequest: gateIntegrationRequestMock,
  buildLookupMaps: vi.fn(async () => ({ stageMap: new Map(), userMap: new Map() })),
  normalizeLead: (lead: unknown) => lead,
  logIntegrationAudit: vi.fn(),
  emitIntegrationEvent: vi.fn(),
  withIntegrationErrorBoundary: (fn: unknown) => fn,
}));

vi.mock("@/lib/api/integration-permissions", () => ({
  requirePermission: () => null, // always authorised in this suite
}));

import { GET } from "./route";

type Call = [method: string, args: unknown[]];

/**
 * Chainable `leads` table double. Records every filter call, and resolves the
 * route's `.order(...).range(...)` tail with an empty successful page.
 */
function makeLeadsChain(calls: Call[]) {
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
    ilike: record("ilike"),
    order: record("order"),
    range: async (...args: unknown[]) => {
      calls.push(["range", args]);
      return { data: [], error: null, count: 0 };
    },
  };
  return chain;
}

function fakeReq(params: Record<string, string>): NextRequest {
  return {
    method: "GET",
    nextUrl: { searchParams: new URLSearchParams(params), pathname: "/api/v1/integrations/crm/leads" },
    headers: new Headers(),
  } as unknown as NextRequest;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
  const supabase = { from: () => makeLeadsChain(calls) };
  gateIntegrationRequestMock.mockResolvedValue({
    ok: true,
    ctx: {
      auth: { tenantId: "tenant-A", integrationKeyId: "key-1", permissions: ["read"] },
      supabase,
      requestId: "req-1",
      ip: "1.2.3.4",
      userAgent: null,
    },
  });
});

function orArgs() {
  return calls.filter(([m]) => m === "or").map(([, a]) => a[0] as string);
}

/**
 * Parse an `.or()` expression into its top-level segments, each of which must
 * be `<column>.ilike."<quoted value>"`. If any part of the string falls
 * outside such a segment, the term escaped its quoting — the whole reason this
 * suite exists.
 */
function orSegments(expr: string): string[] {
  const matches = expr.match(/(?:^|,)[a-z_]+\.ilike\."(?:[^"\\]|\\.)*"/g) ?? [];
  expect(matches.join("")).toBe(expr); // nothing outside a quoted ilike segment
  return matches.map((s) => s.replace(/^,/, "").split(".")[0]);
}
function eqArgs() {
  return calls.filter(([m]) => m === "eq").map(([, a]) => a as [string, unknown]);
}

describe("GET /api/v1/integrations/crm/leads — search sanitisation", () => {
  it("tenant scope is always a top-level .eq(), independent of search", async () => {
    await GET(fakeReq({ search: "x,tenant_id.eq.tenant-B,first_name.ilike.%x" }));
    expect(eqArgs()).toContainEqual(["tenant_id", "tenant-A"]);
  });

  it("a normal search builds a quoted 4-column ilike group", async () => {
    await GET(fakeReq({ search: "chen" }));
    expect(orArgs()).toEqual([
      'first_name.ilike."%chen%",last_name.ilike."%chen%",email.ilike."%chen%",phone.ilike."%chen%"',
    ]);
  });

  it("REGRESSION: crafted search cannot widen beyond the 4 intended fields", async () => {
    await GET(fakeReq({ search: "zzz,is_final.is.true,first_name.ilike.%" }));
    const or = orArgs();
    expect(or).toHaveLength(1);
    // every top-level segment is a quoted ilike on one of the 4 whitelisted
    // columns — the injected `is_final.is.true` predicate is trapped as literal
    // text inside a quoted value, never a new condition.
    expect(new Set(orSegments(or[0]))).toEqual(
      new Set(["first_name", "last_name", "email", "phone"]),
    );
  });

  it("REGRESSION: match-all search=% returns an empty page, not the whole tenant", async () => {
    const res = await GET(fakeReq({ search: "%" }));
    expect(orArgs()).toHaveLength(0);
    const body = await (res as Response).json();
    expect(body.data).toEqual({ leads: [], total: 0, limit: 50, offset: 0 });
  });

  it("REGRESSION: soft-delete filter stays a top-level .is(), un-widened by search", async () => {
    await GET(fakeReq({ search: "zzz,deleted_at.not.is.null,first_name.ilike.%" }));
    expect(calls.some(([m, a]) => m === "is" && (a as unknown[])[0] === "deleted_at" && (a as unknown[])[1] === null)).toBe(true);
    // injected predicate is inert literal text, not a top-level condition
    expect(new Set(orSegments(orArgs()[0]))).toEqual(
      new Set(["first_name", "last_name", "email", "phone"]),
    );
  });
});

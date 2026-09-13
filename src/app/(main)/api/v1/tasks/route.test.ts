import { describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";

// GET /api/v1/tasks — Round 2 slice D (docs/IT-AGENCY-ROUND2-SLICE-D-PERSONAL-TASKS-BRIEF.md
// §3.1): include_personal=1 opts a caller into project-less ("Personal") tasks they're the
// assignee or assigner of, via an `.or()` that composes with scopedClient's auto tenant_id
// filter. Absent the param, behaviour must stay byte-for-byte what it was before this slice.

const authenticateRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

type Call = [method: string, args: unknown[]];

const TENANT_ID = "tenant-A";

// Chainable `tasks` table double: records every filter call (in order) into `calls`,
// seeded with the tenant_id filter scopedClient's select() applies underneath every
// query, so a test can assert it survives alongside the .or()/.not() this route adds.
function makeTasksChain(calls: Call[]) {
  calls.push(["eq", ["tenant_id", TENANT_ID]]);
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  const chain: Record<string, unknown> = {
    eq: record("eq"),
    or: record("or"),
    not: record("not"),
    in: record("in"),
    overlaps: record("overlaps"),
    ilike: record("ilike"),
    is: record("is"),
    gte: record("gte"),
    lte: record("lte"),
    order: record("order"),
    range: () => Promise.resolve({ data: [], error: null, count: 0 }),
  };
  return chain;
}

function fakeDb(calls: Call[], accountProjectIds: string[] = []) {
  return {
    from: (table: string) => {
      if (table === "tasks") {
        return { select: () => makeTasksChain(calls) };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: accountProjectIds.map((id) => ({ id })) }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    raw: () => {
      throw new Error("raw() should not be called — no `due` param in these tests");
    },
  };
}

vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => currentDb) }));

let currentDb: ReturnType<typeof fakeDb>;

import { GET } from "./route";

function permissions(overrides: Partial<ResolvedPermissions> = {}): ResolvedPermissions {
  return {
    baseTier: "member",
    allowedNavKeys: null,
    pipelineAccess: "all",
    listAccess: "all",
    leadScope: "all",
    sharedPoolListIds: new Set(),
    canAssignLeads: false,
    canEditLeads: false,
    canManageApplications: false,
    canManageClasses: false,
    canManageHR: false,
    canManageProjects: false,
    canApproveTime: false,
    canManageBilling: false,
    canExport: false,
    canSendSms: false,
    dashboardWidgets: null,
    ...overrides,
  };
}

function authFixture(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "human@example.com",
    tenantId: TENANT_ID,
    role: "staff",
    industryId: "it_agency",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: permissions(),
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

function req(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function findCall(calls: Call[], method: string) {
  return calls.find(([m]) => m === method);
}

describe("GET /api/v1/tasks", () => {
  it("default request: excludes project-less tasks, same as before this slice", async () => {
    const calls: Call[] = [];
    currentDb = fakeDb(calls);
    authenticateRequestMock.mockResolvedValue(authFixture());

    await GET(req("http://x/api/v1/tasks"));

    expect(findCall(calls, "not")).toEqual(["not", ["project_id", "is", null]]);
    expect(findCall(calls, "or")).toBeUndefined();
  });

  it("include_personal=1 with no project/account filter: applies the .or() with the caller's id", async () => {
    const calls: Call[] = [];
    currentDb = fakeDb(calls);
    authenticateRequestMock.mockResolvedValue(authFixture({ userId: "user-1" }));

    await GET(req("http://x/api/v1/tasks?include_personal=1"));

    expect(findCall(calls, "or")).toEqual([
      "or",
      ["project_id.not.is.null,assignee_id.eq.user-1,assigned_by_id.eq.user-1"],
    ]);
    expect(findCall(calls, "not")).toBeUndefined();
  });

  it("include_personal=1&account_id=…: personal is ignored, project_id-not-null + account's project ids apply", async () => {
    const calls: Call[] = [];
    const accountId = "11111111-1111-1111-1111-111111111111";
    const projectId = "22222222-2222-2222-2222-222222222222";
    currentDb = fakeDb(calls, [projectId]);
    authenticateRequestMock.mockResolvedValue(authFixture());

    await GET(req(`http://x/api/v1/tasks?include_personal=1&account_id=${accountId}`));

    expect(findCall(calls, "or")).toBeUndefined();
    expect(findCall(calls, "not")).toEqual(["not", ["project_id", "is", null]]);
    expect(findCall(calls, "in")).toEqual(["in", ["project_id", [projectId]]]);
  });

  it("include_personal=1&project_id=…: personal is ignored, project_id-not-null + the project filter apply", async () => {
    const calls: Call[] = [];
    const projectId = "22222222-2222-2222-2222-222222222222";
    currentDb = fakeDb(calls);
    authenticateRequestMock.mockResolvedValue(authFixture());

    await GET(req(`http://x/api/v1/tasks?include_personal=1&project_id=${projectId}`));

    expect(findCall(calls, "or")).toBeUndefined();
    expect(findCall(calls, "not")).toEqual(["not", ["project_id", "is", null]]);
    const eqCalls = calls.filter(([m]) => m === "eq");
    expect(eqCalls).toContainEqual(["eq", ["project_id", projectId]]);
  });

  it("restricted-to-self caller with include_personal=1: still only their own tasks (assignee_id eq composes with the .or())", async () => {
    const calls: Call[] = [];
    currentDb = fakeDb(calls);
    authenticateRequestMock.mockResolvedValue(
      authFixture({ userId: "user-1", permissions: permissions({ leadScope: "own" }) }),
    );

    await GET(req("http://x/api/v1/tasks?include_personal=1"));

    expect(findCall(calls, "or")).toEqual([
      "or",
      ["project_id.not.is.null,assignee_id.eq.user-1,assigned_by_id.eq.user-1"],
    ]);
    const eqCalls = calls.filter(([m]) => m === "eq");
    expect(eqCalls).toContainEqual(["eq", ["assignee_id", "user-1"]]);
  });

  it("the tenant_id filter is present alongside the .or() (AND composition survives)", async () => {
    const calls: Call[] = [];
    currentDb = fakeDb(calls);
    authenticateRequestMock.mockResolvedValue(authFixture());

    await GET(req("http://x/api/v1/tasks?include_personal=1"));

    expect(calls[0]).toEqual(["eq", ["tenant_id", TENANT_ID]]);
    expect(findCall(calls, "or")).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// POST /api/v1/projects — account_id optional (internal projects, mig 224),
// tenant-scoped account existence check, creation stays owner|admin.

const auth = vi.hoisted(() => ({
  current: { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "it_agency" } as Record<string, string>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/projects/health", () => ({ computePctComplete: () => 0 }));

const state = vi.hoisted(() => ({ accountExists: true, insertArgs: null as unknown }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.accountExists ? { id: "acc-1" } : null }) }) }) };
      }
      return {
        insert: (args: unknown) => {
          state.insertArgs = args;
          return { select: () => ({ single: async () => ({ data: { id: "proj-1", ...(args as object) }, error: null }) }) };
        },
      };
    },
  })),
}));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  auth.current = { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "it_agency" };
  state.accountExists = true;
  state.insertArgs = null;
});

describe("POST /api/v1/projects", () => {
  it("creates an internal project with no account_id", async () => {
    const res = await POST(req({ name: "Internal site refresh" }));
    expect(res.status).toBe(201);
    expect((state.insertArgs as { account_id: unknown }).account_id).toBeNull();
  });

  it("creates a client project and persists owner_id + dates", async () => {
    const res = await POST(
      req({
        name: "BathroomFort",
        account_id: "11111111-1111-1111-1111-111111111111",
        owner_id: "22222222-2222-2222-2222-222222222222",
        start_date: "2026-09-10",
        target_end_date: "2026-12-01",
      }),
    );
    expect(res.status).toBe(201);
    const args = state.insertArgs as Record<string, unknown>;
    expect(args.owner_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(args.start_date).toBe("2026-09-10");
    expect(args.target_end_date).toBe("2026-12-01");
  });

  it("rejects a foreign-tenant / unknown account_id with 400", async () => {
    state.accountExists = false;
    const res = await POST(req({ name: "X", account_id: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(400);
  });

  it("a non-admin member is forbidden", async () => {
    auth.current.role = "member";
    const res = await POST(req({ name: "X" }));
    expect(res.status).toBe(403);
  });
});

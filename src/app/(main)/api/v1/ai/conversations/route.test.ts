import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const isAssistantEnabledMock = vi.fn();
const isAssistantEnabledForTenantMock = vi.fn();
const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/ai/flag", () => ({
  isAssistantEnabled: isAssistantEnabledMock,
  isAssistantEnabledForTenant: isAssistantEnabledForTenantMock,
}));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1" } as unknown as AuthContext;

function fakeReq(): NextRequest {
  return {} as NextRequest;
}

describe("GET /api/v1/ai/conversations", () => {
  beforeEach(() => {
    isAssistantEnabledMock.mockReset();
    isAssistantEnabledForTenantMock.mockReset();
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
  });

  it("returns the 404 shape when the env flag is off", async () => {
    isAssistantEnabledMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(fakeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(authenticateRequestMock).not.toHaveBeenCalled();
  });

  it("returns the 404 shape when the env flag is on but the tenant lacks the per-tenant grant", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
    isAssistantEnabledForTenantMock.mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET(fakeReq());

    expect(res.status).toBe(404);
    expect(isAssistantEnabledForTenantMock).toHaveBeenCalledWith("tenant-1");
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("lists only the caller's own conversations", async () => {
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
    isAssistantEnabledForTenantMock.mockResolvedValue(true);

    let capturedUserId: string | undefined;
    const rows = [{ id: "c1", title: "Chat 1", created_at: "t1", updated_at: "t2" }];
    const query = {
      eq: vi.fn((col: string, val: string) => {
        if (col === "user_id") capturedUserId = val;
        return query;
      }),
      order: vi.fn(() => query),
      limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    };
    scopedClientMock.mockResolvedValue({
      from: vi.fn(() => ({ select: vi.fn(() => query) })),
    });

    const { GET } = await import("./route");
    const res = await GET(fakeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.conversations).toEqual(rows);
    expect(capturedUserId).toBe("user-1");
  });
});

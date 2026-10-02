import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// No database: the Supabase client and the completeness rule are hand-rolled fakes.
const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const completenessMock = vi.fn();
const shouldRestrictToSelfMock = vi.fn();
const requireLeadBranchAccessMock = vi.fn();
let leadRow: Record<string, unknown> | null = { id: "lead-1", assigned_to: "user-1", branch_id: null };

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, authenticateRequest: authenticateRequestMock, requireLeadBranchAccess: requireLeadBranchAccessMock };
});
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    const t: Record<string, unknown> = {};
    t.select = vi.fn(() => t);
    t.eq = vi.fn(() => t);
    t.is = vi.fn(() => t);
    t.single = vi.fn(async () => ({ data: leadRow }));
    return { from: vi.fn(() => t) };
  },
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: shouldRestrictToSelfMock }));
vi.mock("@/lib/leads/profile-completeness", () => ({ checkLeadProfileCompleteness: completenessMock }));

function authAs(): AuthContext {
  return { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy", role: "admin", permissions: {} } as unknown as AuthContext;
}
const params = () => ({ params: Promise.resolve({ id: "lead-1" }) });

beforeEach(() => {
  authenticateRequestMock.mockReset().mockResolvedValue(authAs());
  getFeatureAccessMock.mockReset().mockReturnValue(true);
  completenessMock.mockReset().mockResolvedValue({ complete: true, missing: [] });
  shouldRestrictToSelfMock.mockReset().mockReturnValue(false);
  requireLeadBranchAccessMock.mockReset().mockReturnValue(true);
  leadRow = { id: "lead-1", assigned_to: "user-1", branch_id: null };
});

describe("GET /api/v1/leads/[id]/profile-completeness", () => {
  it("reports what is missing, using the same rule the create-application APIs enforce", async () => {
    completenessMock.mockResolvedValue({ complete: false, missing: ["Email", "a document"] });
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ complete: false, missing: ["Email", "a document"] });
    expect(completenessMock).toHaveBeenCalledWith(expect.anything(), "tenant-1", "lead-1");
  });

  it("reports complete: true with nothing missing for a complete profile", async () => {
    const { GET } = await import("./route");
    const body = await (await GET({} as NextRequest, params())).json();
    expect(body.data).toEqual({ complete: true, missing: [] });
  });

  it("401 when not signed in, and never runs the check", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    expect((await GET({} as NextRequest, params())).status).toBe(401);
    expect(completenessMock).not.toHaveBeenCalled();
  });

  it("403 for a tenant without Application Tracking", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    expect((await GET({} as NextRequest, params())).status).toBe(403);
    expect(completenessMock).not.toHaveBeenCalled();
  });

  it("404 for a lead that is not in this tenant", async () => {
    leadRow = null;
    const { GET } = await import("./route");
    expect((await GET({} as NextRequest, params())).status).toBe(404);
    expect(completenessMock).not.toHaveBeenCalled();
  });

  it("404 (not 403) when a counselor asks about a lead that isn't theirs — same as the consent route", async () => {
    shouldRestrictToSelfMock.mockReturnValue(true);
    leadRow = { id: "lead-1", assigned_to: "someone-else", branch_id: null };
    const { GET } = await import("./route");
    expect((await GET({} as NextRequest, params())).status).toBe(404);
    expect(completenessMock).not.toHaveBeenCalled();
  });

  it("404 when branch access is denied", async () => {
    requireLeadBranchAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    expect((await GET({} as NextRequest, params())).status).toBe(404);
    expect(completenessMock).not.toHaveBeenCalled();
  });
});

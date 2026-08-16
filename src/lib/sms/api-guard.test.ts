import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// SMS-PHASE3B-FIX-F6-BRIEF.md: requireSmsAccess() must require
// canSendSms for READS as well as writes — the tenant-wide DNC list, blast
// history, and credit balance were reachable by any authenticated tenant
// member (e.g. a counselor) because the permission check only ran when a
// caller opted in with requireSend: true. That option no longer exists —
// the check is unconditional.

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const isSmsEnabledForTenantMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("./flag", () => ({ isSmsEnabledForTenant: isSmsEnabledForTenantMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

function auth(canSendSms: boolean): AuthContext {
  return {
    userId: "user-1",
    email: "counselor@admizz.local",
    tenantId: "tenant-1",
    role: "counselor",
    industryId: "education_consultancy",
    permissions: { canSendSms },
  } as unknown as AuthContext;
}

describe("requireSmsAccess", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    getFeatureAccessMock.mockReset().mockReturnValue(true);
    isSmsEnabledForTenantMock.mockReset().mockResolvedValue(true);
    scopedClientMock.mockReset().mockResolvedValue({ scoped: true });
  });

  it("a member with canSendSms false is forbidden on a READ path (no requireSend option exists anymore)", async () => {
    authenticateRequestMock.mockResolvedValue(auth(false));
    const { requireSmsAccess } = await import("./api-guard");

    const result = await requireSmsAccess();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("a member with canSendSms true passes and gets a scoped client", async () => {
    authenticateRequestMock.mockResolvedValue(auth(true));
    const { requireSmsAccess } = await import("./api-guard");

    const result = await requireSmsAccess();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.db).toEqual({ scoped: true });
  });

  it("unauthenticated caller gets 401 before any permission check", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { requireSmsAccess } = await import("./api-guard");

    const result = await requireSmsAccess();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(getFeatureAccessMock).not.toHaveBeenCalled();
  });

  it("industry gate still runs before the permission check", async () => {
    authenticateRequestMock.mockResolvedValue(auth(true));
    getFeatureAccessMock.mockReturnValue(false);
    const { requireSmsAccess } = await import("./api-guard");

    const result = await requireSmsAccess();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(isSmsEnabledForTenantMock).not.toHaveBeenCalled();
  });

  it("tenant-flag gate still runs before the permission check", async () => {
    authenticateRequestMock.mockResolvedValue(auth(true));
    isSmsEnabledForTenantMock.mockResolvedValue(false);
    const { requireSmsAccess } = await import("./api-guard");

    const result = await requireSmsAccess();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });
});

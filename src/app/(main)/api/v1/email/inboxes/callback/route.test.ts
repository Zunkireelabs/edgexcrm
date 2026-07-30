import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import { signState } from "@/lib/email/oauth-state";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/industries/_shared/features/email/lib/gmail-client", () => ({ getUserInfoEmail: vi.fn() }));
vi.mock("@/industries/_shared/features/email/lib/token-crypto", () => ({ encryptAccountToken: vi.fn() }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;

function fakeCallbackRequest(params: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3001/api/v1/email/inboxes/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

describe("GET /api/v1/email/inboxes/callback — NEXTAUTH_SECRET fail-closed (PROD-HARDEN §1.1)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.NEXTAUTH_SECRET = "a".repeat(64);
    authenticateRequestMock.mockReset().mockResolvedValue(FAKE_AUTH);
    getFeatureAccessMock.mockReset().mockReturnValue(true);
  });

  it("refuses to verify — redirects with error=invalid_state — when NEXTAUTH_SECRET is unset, even though a validly-signed-elsewhere state and NEXT_PUBLIC_SUPABASE_ANON_KEY are present", async () => {
    // Signed while the secret was still set, mirroring a real connect->callback round trip.
    const state = signState(FAKE_AUTH.userId);

    delete process.env.NEXTAUTH_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key-not-a-secret";

    const { GET } = await import("./route");
    const res = await GET(fakeCallbackRequest({ code: "auth-code", state }));

    expect(res.status).toBe(307); // NextResponse.redirect default
    const location = res.headers.get("location")!;
    expect(location).toContain("error=invalid_state");
  });

  it("accepts a correctly-signed state when NEXTAUTH_SECRET is set (proceeds past the state check)", async () => {
    const state = signState(FAKE_AUTH.userId);
    // GOOGLE_CLIENT_ID/SECRET deliberately unset here — proves the request got
    // past verifyState (no invalid_state redirect) without needing a live
    // token-exchange network call.
    const { GET } = await import("./route");
    const res = await GET(fakeCallbackRequest({ code: "auth-code", state }));
    const location = res.headers.get("location")!;
    expect(location).toContain("error=not_configured");
    expect(location).not.toContain("error=invalid_state");
  });
});

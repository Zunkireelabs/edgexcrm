import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;

function fakeRequest(): Request {
  return { json: async () => ({}) } as unknown as Request;
}

describe("POST /api/v1/email/inboxes/connect — NEXTAUTH_SECRET fail-closed (PROD-HARDEN §1.1)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.NEXTAUTH_SECRET = "a".repeat(64);
    authenticateRequestMock.mockReset().mockResolvedValue(FAKE_AUTH);
    getFeatureAccessMock.mockReset().mockReturnValue(true);
  });

  it("returns a signed auth URL when NEXTAUTH_SECRET is set", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const url = new URL(body.data.url);
    const state = url.searchParams.get("state")!;
    expect(state.startsWith(`${FAKE_AUTH.userId}.`)).toBe(true);
  });

  it("503s — no fallback — when NEXTAUTH_SECRET is unset, even though NEXT_PUBLIC_SUPABASE_ANON_KEY is set", async () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key-not-a-secret";
    const { POST } = await import("./route");
    const res = await POST(fakeRequest());
    expect(res.status).toBe(503);
  });
});

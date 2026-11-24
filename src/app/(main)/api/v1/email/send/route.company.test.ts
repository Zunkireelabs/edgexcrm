import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// POST /api/v1/email/send — the "company" hand-off. The Gmail path has its own suite (route.test.ts);
// this only pins that "company" goes to handleCompanySend and NEVER touches Gmail accounts, and that
// anything else that isn't a UUID is still rejected exactly as before.

const authMock = vi.fn();
const scopedClientMock = vi.fn();
const handleCompanySendMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10, limit: 10, resetAt: 0, retryAfterSeconds: 0 }),
  EMAIL_SEND_LIMIT: { maxRequests: 30, windowMs: 60_000 },
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: (...a: unknown[]) => scopedClientMock(...a) }));
vi.mock("@/lib/api/audit", () => ({ emitEvent: async () => "e" }));
vi.mock("@/industries/_shared/features/email/lib/gmail-client", () => ({ sendMessage: vi.fn() }));
vi.mock("@/industries/_shared/features/email/lib/token-crypto", () => ({
  decryptAccountTokens: (r: unknown) => r,
  persistRefreshedToken: vi.fn(),
}));
vi.mock("@/lib/email/company-send", () => ({ handleCompanySend: (...a: unknown[]) => handleCompanySendMock(...a) }));

import { POST } from "./route";

const AUTH = { userId: "u1", tenantId: "tenant-a", industryId: "education_consultancy", permissions: {} } as unknown as AuthContext;
const req = (body: unknown) => ({ json: async () => body }) as unknown as Request;

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(AUTH);
  scopedClientMock.mockReset();
  handleCompanySendMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
});

describe("POST /api/v1/email/send — from_account_id: 'company'", () => {
  it("hands off to handleCompanySend with the auth context and body, and never opens a Gmail account lookup", async () => {
    const body = { from_account_id: "company", to: ["a@b.com"], subject: "S", body_html: "<p>x</p>" };
    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(handleCompanySendMock).toHaveBeenCalledTimes(1);
    expect(handleCompanySendMock.mock.calls[0][0]).toBe(AUTH);
    expect(handleCompanySendMock.mock.calls[0][1]).toMatchObject(body);
    expect(scopedClientMock).not.toHaveBeenCalled(); // the Gmail path (which needs the db for the account lookup) was never entered
  });

  it("still validates subject and body for the company path", async () => {
    const res = await POST(req({ from_account_id: "company", to: ["a@b.com"], body_html: "<p>x</p>" }));
    expect(res.status).toBe(422);
    expect(handleCompanySendMock).not.toHaveBeenCalled();
  });

  it("still rejects a from_account_id that is neither a UUID nor 'company' (Gmail path unchanged)", async () => {
    for (const bad of ["not-a-uuid", "COMPANY", "company ", "", "other"]) {
      const res = await POST(req({ from_account_id: bad, to: ["a@b.com"], subject: "S", body_html: "<p>x</p>" }));
      expect(res.status).toBe(422);
    }
    expect(handleCompanySendMock).not.toHaveBeenCalled();
  });
});

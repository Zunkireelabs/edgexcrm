import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

const authMock = vi.fn();
const gateMock = vi.fn(() => true);
const resolveMock = vi.fn();
const noReplyMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => gateMock() }));
vi.mock("@/lib/email/sender", () => ({ resolveVerifiedCompanySender: (...a: unknown[]) => resolveMock(...a) }));
vi.mock("@/lib/email/no-reply-sender", () => ({ resolveNoReplySender: (...a: unknown[]) => noReplyMock(...a) }));

import { GET } from "./route";

const AUTH = { userId: "u1", tenantId: "tenant-a", industryId: "education_consultancy", permissions: {} } as unknown as AuthContext;

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(AUTH);
  gateMock.mockReset().mockReturnValue(true);
  resolveMock.mockReset();
  noReplyMock.mockReset().mockResolvedValue(null);
});

describe("GET /api/v1/email/company-sender", () => {
  it("401s without a session", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("403s a tenant whose industry doesn't have the email feature", async () => {
    gateMock.mockReturnValue(false);
    expect((await GET()).status).toBe(403);
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("returns the verified company address and display name — for the caller's own tenant only", async () => {
    resolveMock.mockResolvedValue({ from: "x", address: "hello@mail.admizz.com", name: "Admizz Education", replyTo: "hello@admizz.com" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ email: "hello@mail.admizz.com", display_name: "Admizz Education", no_reply: null });
    expect(resolveMock).toHaveBeenCalledWith("tenant-a");
  });

  it("returns null (not an error) when the tenant has no verified sender", async () => {
    resolveMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toBeNull();
  });

  it("does not leak the Reply-To mailbox address to the browser", async () => {
    resolveMock.mockResolvedValue({ from: "x", address: "hello@mail.admizz.com", name: "Admizz", replyTo: "secret-team@admizz.com" });
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain("secret-team@admizz.com");
  });
});

describe("GET /api/v1/email/company-sender: the no-reply sender", () => {
  const COMPANY = { from: "x", address: "hello@mail.admizz.com", name: "Admizz Education", replyTo: "hello@admizz.com" };
  const NO_REPLY = {
    sender: { from: "x", address: "no-reply@mail.admizz.com", name: "Admizz Education", replyTo: "hello@admizz.com" },
    brand: { name: "Admizz Education", logoUrl: "https://cdn.example.com/logo.png", color: "#0D1282", accent: "#FDED22", helpEmail: "hello@admizz.com" },
  };

  it("includes it, with what the pop-up needs to draw the frame, when the tenant has it set up", async () => {
    resolveMock.mockResolvedValue(COMPANY);
    noReplyMock.mockResolvedValue(NO_REPLY);
    const data = (await (await GET()).json()).data;
    expect(data).toEqual({
      email: "hello@mail.admizz.com",
      display_name: "Admizz Education",
      no_reply: { email: "no-reply@mail.admizz.com", display_name: "Admizz Education", brand: NO_REPLY.brand },
    });
    expect(noReplyMock).toHaveBeenCalledWith("tenant-a");
  });

  it("is null when the tenant has not set it up, and the company address is still returned", async () => {
    resolveMock.mockResolvedValue(COMPANY);
    const data = (await (await GET()).json()).data;
    expect(data.no_reply).toBeNull();
    expect(data.email).toBe("hello@mail.admizz.com");
  });

  it("without a verified company sender there is no no-reply either (and it is not even looked up)", async () => {
    resolveMock.mockResolvedValue(null);
    noReplyMock.mockResolvedValue(NO_REPLY);
    expect((await (await GET()).json()).data).toBeNull();
    expect(noReplyMock).not.toHaveBeenCalled();
  });
});

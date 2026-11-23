import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => ({})) }));
const { createChatSession } = vi.hoisted(() => ({ createChatSession: vi.fn() }));
vi.mock("@/lib/inbox/website-chat/session", () => ({ createChatSession }));

import { NextRequest } from "next/server";
import { POST, OPTIONS } from "./route";

const req = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("https://crm.example.com/api/public/chat/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => createChatSession.mockReset());

describe("POST /api/public/chat/session", () => {
  it("answers the preflight without naming a tenant, and allows only POST with a JSON body", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type");
  });

  it("on success names the ONE allowed origin (never *), varies on it and is never cached", async () => {
    createChatSession.mockResolvedValue({
      ok: true,
      origin: "https://admizzeducation.com",
      session: { chatwootBaseUrl: "https://inbox.example.com", inboxIdentifier: "id", identifier: "visitor", identifierHash: "hash" },
    });
    const res = await POST(req({ inbox: "id" }, { origin: "https://admizzeducation.com", "x-forwarded-for": "9.9.9.9, 10.0.0.1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://admizzeducation.com");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await res.json())).toContain("hash");
    // The visitor's address and the browser's Origin header are what get checked.
    expect(createChatSession).toHaveBeenCalledWith(expect.objectContaining({ inboxIdentifier: "id", origin: "https://admizzeducation.com", ip: "9.9.9.9" }));
  });

  it("on refusal sends no CORS permission at all, so another website's script cannot read it", async () => {
    createChatSession.mockResolvedValue({ ok: false, status: 403, code: "FORBIDDEN", message: "This website is not allowed to use this chat" });
    const res = await POST(req({ inbox: "id" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("passes a rate limit through as 429 with Retry-After", async () => {
    createChatSession.mockResolvedValue({ ok: false, status: 429, code: "RATE_LIMITED", message: "x", retryAfterSeconds: 30 });
    const res = await POST(req({ inbox: "id" }, { origin: "https://admizzeducation.com" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("treats a body that is not JSON as a missing inbox id", async () => {
    createChatSession.mockResolvedValue({ ok: false, status: 400, code: "VALIDATION_ERROR", message: "Invalid chat id" });
    const bad = new NextRequest("https://crm.example.com/api/public/chat/session", { method: "POST", body: "not json" });
    expect((await POST(bad)).status).toBe(400);
    expect(createChatSession).toHaveBeenCalledWith(expect.objectContaining({ inboxIdentifier: undefined }));
  });
});

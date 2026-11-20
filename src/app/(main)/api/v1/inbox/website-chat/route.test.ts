import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

const service = vi.hoisted(() => ({
  loadWebsiteChat: vi.fn(),
  connectWebsiteChat: vi.fn(),
  updateWebsiteChat: vi.fn(),
}));

vi.mock("@/lib/inbox/website-chat/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inbox/website-chat/service")>("@/lib/inbox/website-chat/service");
  return { ...actual, ...service };
});

const rawDb = vi.hoisted(() => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Admizz Education" } }) }) }) }),
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ raw: () => rawDb })) }));

import { GET, POST, PATCH } from "./route";
import { DEFAULT_WEBSITE_CHAT_SETTINGS } from "@/lib/inbox/website-chat/settings";
import { WebsiteChatError } from "@/lib/inbox/website-chat/service";

const connected = {
  connected: true,
  enabled: true,
  settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" },
  snippet: "<script/>",
};

function req(body: unknown) {
  return new Request("http://localhost/api/v1/inbox/website-chat", { method: "POST", body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INBOX_CHATWOOT_ENABLED = "true";
  auth.current = { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "education_consultancy" };
  service.loadWebsiteChat.mockResolvedValue(connected);
  service.connectWebsiteChat.mockResolvedValue(connected);
  service.updateWebsiteChat.mockResolvedValue(connected);
});

describe("access", () => {
  it("is 404 for everyone when website chat is not enabled on the server", async () => {
    process.env.INBOX_CHATWOOT_ENABLED = "false";
    expect((await GET()).status).toBe(404);
    expect((await POST(req({ websiteHost: "a.com" }))).status).toBe(404);
    expect((await PATCH(req({ color: "teal" }))).status).toBe(404);
    expect(service.loadWebsiteChat).not.toHaveBeenCalled();
  });

  it("is 401 when signed out", async () => {
    auth.current = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(req({ websiteHost: "a.com" }))).status).toBe(401);
    expect((await PATCH(req({}))).status).toBe(401);
  });

  it.each(["viewer", "counselor"])("is 403 for a %s on every method", async (role) => {
    auth.current = { ...auth.current, role };
    expect((await GET()).status).toBe(403);
    expect((await POST(req({ websiteHost: "a.com" }))).status).toBe(403);
    expect((await PATCH(req({ color: "teal" }))).status).toBe(403);
    expect(service.connectWebsiteChat).not.toHaveBeenCalled();
    expect(service.updateWebsiteChat).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it("always uses the tenant of the session, ignoring any tenant sent in the body", async () => {
    await POST(req({ websiteHost: "admizzeducation.com", tenantId: "tenant-B", tenant_id: "tenant-B" }));
    expect(service.connectWebsiteChat).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-A", tenantName: "Admizz Education" }));

    await PATCH(req({ color: "teal", tenantId: "tenant-B" }));
    expect(service.updateWebsiteChat).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-A" }));
    expect(service.loadWebsiteChat).toHaveBeenCalledWith(expect.anything(), "tenant-A");
  });
});

describe("POST", () => {
  it("connects and returns 201", async () => {
    const res = await POST(req({ websiteHost: "https://www.admizzeducation.com/x" }));
    expect(res.status).toBe(201);
    expect(service.connectWebsiteChat).toHaveBeenCalledWith(expect.objectContaining({ websiteHost: "www.admizzeducation.com" }));
  });

  it("rejects a bad website address with 422 and does not call Chatwoot", async () => {
    expect((await POST(req({ websiteHost: "nope" }))).status).toBe(422);
    expect((await POST(req({}))).status).toBe(422);
    expect(service.connectWebsiteChat).not.toHaveBeenCalled();
  });

  it("is 409 when already connected and 503 when Chatwoot fails, without leaking details", async () => {
    service.connectWebsiteChat.mockRejectedValueOnce(new WebsiteChatError("Website chat is already connected", "already_connected"));
    expect((await POST(req({ websiteHost: "a.com" }))).status).toBe(409);

    service.connectWebsiteChat.mockRejectedValueOnce(new WebsiteChatError("Could not set up website chat.", "chatwoot_failed"));
    const res = await POST(req({ websiteHost: "a.com" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("Chatwoot returned");
  });
});

describe("PATCH", () => {
  it("merges the change onto the current settings and can switch chat off", async () => {
    await PATCH(req({ color: "teal", enabled: false }));
    expect(service.updateWebsiteChat).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, settings: expect.objectContaining({ color: "teal", title: connected.settings.title }) })
    );
  });

  it("keeps the current on/off state when enabled is not sent", async () => {
    await PATCH(req({ title: "Hello" }));
    expect(service.updateWebsiteChat).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it("is 404 when not connected yet", async () => {
    service.loadWebsiteChat.mockResolvedValueOnce({ connected: false, enabled: false, settings: null, snippet: null });
    expect((await PATCH(req({ color: "teal" }))).status).toBe(404);
  });

  it("rejects an invalid colour and a non-boolean enabled with 422", async () => {
    expect((await PATCH(req({ color: "#123456" }))).status).toBe(422);
    expect((await PATCH(req({ enabled: "yes" }))).status).toBe(422);
    expect(service.updateWebsiteChat).not.toHaveBeenCalled();
  });
});

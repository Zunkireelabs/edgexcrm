import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

const service = vi.hoisted(() => ({
  uploadWebsiteChatLogo: vi.fn(),
  removeWebsiteChatLogo: vi.fn(),
}));

vi.mock("@/lib/inbox/website-chat/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inbox/website-chat/service")>("@/lib/inbox/website-chat/service");
  return { ...actual, ...service };
});

vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ raw: () => ({}) })) }));

import { POST, DELETE } from "./route";
import { WebsiteChatError } from "@/lib/inbox/website-chat/service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function upload(bytes: Uint8Array | null, name = "logo.png") {
  const form = new FormData();
  if (bytes) form.append("logo", new File([bytes as BlobPart], name, { type: "image/png" }));
  return new Request("http://localhost/api/v1/inbox/website-chat/logo", { method: "POST", body: form }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INBOX_CHATWOOT_ENABLED = "true";
  auth.current = { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "education_consultancy" };
  service.uploadWebsiteChatLogo.mockResolvedValue({ connected: true, enabled: true, settings: {}, snippet: "<script/>", logoUrl: "https://chat.example.com/logo.png" });
  service.removeWebsiteChatLogo.mockResolvedValue({ connected: true, enabled: true, settings: {}, snippet: "<script/>", logoUrl: null });
});

describe("access", () => {
  it("is 404 when website chat is not enabled on the server", async () => {
    process.env.INBOX_CHATWOOT_ENABLED = "false";
    expect((await POST(upload(PNG))).status).toBe(404);
    expect((await DELETE()).status).toBe(404);
    expect(service.uploadWebsiteChatLogo).not.toHaveBeenCalled();
  });

  it("is 401 signed out and 403 for a counselor or viewer", async () => {
    auth.current = null;
    expect((await POST(upload(PNG))).status).toBe(401);
    auth.current = { userId: "u-2", email: "c@b.c", tenantId: "tenant-A", role: "counselor", industryId: "education_consultancy" };
    expect((await POST(upload(PNG))).status).toBe(403);
    expect((await DELETE()).status).toBe(403);
    expect(service.uploadWebsiteChatLogo).not.toHaveBeenCalled();
    expect(service.removeWebsiteChatLogo).not.toHaveBeenCalled();
  });
});

describe("POST (upload)", () => {
  it("passes a real image on, using the tenant from the session and a safe file name", async () => {
    const res = await POST(upload(PNG, "../../evil name.png"));
    expect(res.status).toBe(200);
    const arg = service.uploadWebsiteChatLogo.mock.calls[0][0];
    expect(arg.tenantId).toBe("tenant-A");
    expect(arg.file).toMatchObject({ type: "image/png", name: "chat-logo.png" });
    expect((await res.json()).data.logoUrl).toBe("https://chat.example.com/logo.png");
  });

  it("422 when no file was sent", async () => {
    expect((await POST(upload(null))).status).toBe(422);
    expect(service.uploadWebsiteChatLogo).not.toHaveBeenCalled();
  });

  it("422 for an SVG, even if it claims to be a PNG", async () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const res = await POST(upload(svg, "logo.png"));
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain("SVG");
    expect(service.uploadWebsiteChatLogo).not.toHaveBeenCalled();
  });

  it("422 for a file over 1 MB", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    expect((await POST(upload(big))).status).toBe(422);
    expect(service.uploadWebsiteChatLogo).not.toHaveBeenCalled();
  });

  it("maps a not-connected tenant to 404 and a Chatwoot failure to 503 without detail", async () => {
    service.uploadWebsiteChatLogo.mockRejectedValueOnce(new WebsiteChatError("Website chat is not connected", "not_connected"));
    expect((await POST(upload(PNG))).status).toBe(404);
    service.uploadWebsiteChatLogo.mockRejectedValueOnce(new WebsiteChatError("Could not upload the logo. Please try again.", "chatwoot_failed"));
    const res = await POST(upload(PNG));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("HTTP");
  });
});

describe("DELETE (remove)", () => {
  it("removes the logo for the session's tenant", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(service.removeWebsiteChatLogo).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-A" }));
  });
});

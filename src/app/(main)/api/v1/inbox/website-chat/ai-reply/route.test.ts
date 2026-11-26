import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// PUT /api/v1/inbox/website-chat/ai-reply — the AI replies switch. Admizz (education) only, admin only, server must be set up.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let channel: Row | null;
let updated: Row | null;
let industry: string;
let role: string;

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: async () => ({ userId: "u1", tenantId: "tenant-a", role, industryId: industry, permissions: {} }),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    raw: () => ({
      from: () => {
        const st = { op: "select", payload: undefined as Row | undefined };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
          eq: () => b,
          maybeSingle: async () => ({ data: channel, error: null }),
          then: (res: (v: unknown) => unknown) => {
            if (st.op === "update") updated = st.payload ?? null;
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return b;
      },
    }),
  }),
}));

import { PUT } from "./route";

const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  channel = { id: "ch-1", meta: { website_chat: { enabled: true }, webhook_secret_enc: "s", website_chat_ai: { enabled: false, siteId: "" } } };
  updated = null;
  industry = "education_consultancy";
  role = "admin";
  vi.stubEnv("INBOX_CHATWOOT_ENABLED", "true");
  vi.stubEnv("INBOX_AI_REPLY_ENABLED", "true");
  vi.stubEnv("ZUNKIREE_SEARCH_URL", "https://api.example.com");
  vi.stubEnv("ZUNKIREE_SEARCH_KEY", "k");
});
afterEach(() => vi.unstubAllEnvs());

describe("AI replies settings route", () => {
  it("is hidden (404) for other industries, and when the server is not set up", async () => {
    industry = "it_agency";
    expect((await put({ enabled: false, siteId: "" })).status).toBe(404);
    industry = "education_consultancy";
    vi.stubEnv("INBOX_AI_REPLY_ENABLED", "false");
    expect((await put({ enabled: false, siteId: "" })).status).toBe(404);
  });

  it("is admin only", async () => {
    role = "staff";
    expect((await put({ enabled: false, siteId: "" })).status).toBe(403);
  });

  it("saves ONLY the AI key and keeps the widget settings and secrets in meta", async () => {
    const res = await put({ enabled: true, siteId: "admizz-edu" });
    expect(res.status).toBe(200);
    expect(updated!.meta).toEqual({
      website_chat: { enabled: true },
      webhook_secret_enc: "s",
      website_chat_ai: { enabled: true, siteId: "admizz-edu" },
    });
  });

  it("refuses turning it on without a site id, and writes nothing", async () => {
    const res = await put({ enabled: true, siteId: "" });
    expect(res.status).toBe(422);
    expect(updated).toBeNull();
  });

  it("404s when website chat is not connected", async () => {
    channel = null;
    expect((await put({ enabled: false, siteId: "" })).status).toBe(404);
  });
});

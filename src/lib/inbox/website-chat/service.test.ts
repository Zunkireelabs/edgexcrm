import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { connectWebsiteChat, updateWebsiteChat, loadWebsiteChat, WebsiteChatError } from "./service";
import { decryptToken } from "../crypto";
import { DEFAULT_WEBSITE_CHAT_SETTINGS } from "./settings";

const calls: Array<{ method: string; url: string; token: string; body: unknown }> = [];
let failOn: string | null = null;

function fakeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ method: init.method, url, token: init.headers.api_access_token, body: init.body ? JSON.parse(init.body) : undefined });
    if (failOn && url.includes(failOn)) return new Response("secret failure detail", { status: 500 });
    const key = Object.keys(responses).find((k) => url.endsWith(k));
    return new Response(JSON.stringify(key ? responses[key] : {}), { status: 200 });
  });
}

const chatwootResponses = {
  "/platform/api/v1/accounts": { id: 7 },
  "/platform/api/v1/users": { id: 11, access_token: "team-token" },
  "/api/v1/accounts/7/inboxes": { id: 9, website_token: "site-token" },
  "/api/v1/accounts/7/webhooks": { payload: { webhook: { secret: "whsec" } } },
};

function fakeDb(existing: unknown = null) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const db = {
    inserted,
    updated,
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing }) }) }) }),
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return filters.length >= 2 ? Promise.resolve({ error: null }) : chain;
          },
        };
        updated.push({ patch, filters });
        return chain;
      },
    }),
  };
  return db;
}

beforeEach(() => {
  calls.length = 0;
  failOn = null;
  process.env.INBOX_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
  process.env.CHATWOOT_BASE_URL = "https://inbox.example.com";
  process.env.CHATWOOT_PLATFORM_TOKEN = "platform-token";
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
});

afterEach(() => vi.unstubAllGlobals());

const input = (db: ReturnType<typeof fakeDb>) => ({
  db: db as never,
  tenantId: "tenant-A",
  tenantName: "Admizz Education",
  userId: "u-1",
  websiteHost: "admizzeducation.com",
});

describe("connectWebsiteChat", () => {
  it("creates the account, team user, inbox and webhook, then stores the channel with encrypted secrets", async () => {
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    const db = fakeDb();
    const state = await connectWebsiteChat(input(db));

    expect(calls.map((c) => `${c.method} ${c.url.replace("https://inbox.example.com", "")}`)).toEqual([
      "POST /platform/api/v1/accounts",
      "POST /platform/api/v1/users",
      "POST /platform/api/v1/accounts/7/account_users",
      "POST /api/v1/accounts/7/inboxes",
      "POST /api/v1/accounts/7/inbox_members",
      "POST /api/v1/accounts/7/webhooks",
    ]);
    // Platform calls use the platform token; account calls use the new team user's token.
    expect(calls[0].token).toBe("platform-token");
    expect(calls[3].token).toBe("team-token");
    expect((calls[3].body as { channel: { type: string } }).channel.type).toBe("web_widget");
    expect(calls[5].body).toEqual({ webhook: { url: "https://crm.example.com/api/webhooks/chatwoot", subscriptions: ["message_created"] } });
    // The made-up team email can never receive mail.
    expect((calls[1].body as { email: string }).email).toMatch(/@chat\.invalid$/);

    expect(db.inserted).toHaveLength(1);
    const row = db.inserted[0] as { external_account_id: string; access_token: string; status: string; meta: { webhook_secret_enc: string } };
    expect(row).toMatchObject({ tenant_id: "tenant-A", provider: "chatwoot", external_account_id: "7:9", status: "active" });
    expect(row.access_token).not.toContain("team-token");
    expect(decryptToken(row.access_token)).toBe("team-token");
    expect(decryptToken(row.meta.webhook_secret_enc)).toBe("whsec");

    expect(state).toMatchObject({ connected: true, enabled: true });
    expect(state.snippet).toContain("site-token");
    expect(state.snippet).not.toContain("team-token");
  });

  it("refuses when already connected, without calling Chatwoot", async () => {
    const fetchMock = fakeFetch(chatwootResponses);
    vi.stubGlobal("fetch", fetchMock);
    await expect(connectWebsiteChat(input(fakeDb({ id: "chan-1", meta: {} })))).rejects.toMatchObject({ code: "already_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what to do when the existing channel was set up by hand (no saved card settings)", async () => {
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    await expect(connectWebsiteChat(input(fakeDb({ id: "chan-1", meta: {} })))).rejects.toMatchObject({
      code: "already_connected",
      message: expect.stringContaining("set up by hand"),
    });
  });

  it("keeps the plain message when the card itself already connected it", async () => {
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    const cardRow = { id: "chan-1", meta: { website_chat: { enabled: true, websiteToken: "tok", settings: {} } } };
    await expect(connectWebsiteChat(input(fakeDb(cardRow)))).rejects.toMatchObject({
      code: "already_connected",
      message: "Website chat is already connected",
    });
  });

  it("fails clearly when the platform token is missing", async () => {
    delete process.env.CHATWOOT_PLATFORM_TOKEN;
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    await expect(connectWebsiteChat(input(fakeDb()))).rejects.toMatchObject({ code: "not_configured" });
  });

  it("stores nothing and leaks no Chatwoot detail when a step fails", async () => {
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    failOn = "/webhooks";
    const db = fakeDb();
    const err = await connectWebsiteChat(input(db)).catch((e) => e);
    expect(err).toBeInstanceOf(WebsiteChatError);
    expect(err.code).toBe("chatwoot_failed");
    expect(err.message).not.toContain("500");
    expect(db.inserted).toHaveLength(0);
  });
});

describe("updateWebsiteChat", () => {
  const stored = (enabled = true) => ({
    id: "chan-1",
    external_account_id: "7:9",
    access_token: null as string | null,
    meta: {
      webhook_secret_enc: "x",
      website_chat: { settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" }, enabled, websiteToken: "site-token" },
    },
  });

  it("pushes to Chatwoot with the stored token, then saves, filtering by id and tenant", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    const { encryptToken } = await import("../crypto");
    const row = { ...stored(), access_token: encryptToken("team-token") };
    const db = fakeDb(row);
    const settings = { ...row.meta.website_chat.settings, color: "teal" as const };

    const state = await updateWebsiteChat({ db: db as never, tenantId: "tenant-A", settings, enabled: false });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PATCH", token: "team-token" });
    expect(calls[0].url).toBe("https://inbox.example.com/api/v1/accounts/7/inboxes/9");
    expect((calls[0].body as { channel: Record<string, unknown> }).channel).not.toHaveProperty("type");
    expect((calls[0].body as { channel: { allowed_domains: string } }).channel.allowed_domains).toContain(".invalid");
    // Off is stored in meta only. The status column is never written: the database allows only
    // active / disconnected / error / pending, so a "paused" value would be rejected.
    expect(db.updated[0].patch).not.toHaveProperty("status");
    expect((db.updated[0].patch as { meta: { website_chat: { enabled: boolean } } }).meta.website_chat.enabled).toBe(false);
    expect(db.updated[0].filters).toEqual([["id", "chan-1"], ["tenant_id", "tenant-A"]]);
    expect(state).toMatchObject({ enabled: false, settings: { color: "teal" } });
  });

  it("does not save in EdgeX when Chatwoot refuses", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    failOn = "/inboxes/9";
    const { encryptToken } = await import("../crypto");
    const db = fakeDb({ ...stored(), access_token: encryptToken("team-token") });
    await expect(
      updateWebsiteChat({ db: db as never, tenantId: "tenant-A", settings: stored().meta.website_chat.settings, enabled: true })
    ).rejects.toMatchObject({ code: "chatwoot_failed" });
    expect(db.updated).toHaveLength(0);
  });

  it("says not connected when there is no channel", async () => {
    await expect(
      updateWebsiteChat({ db: fakeDb(null) as never, tenantId: "tenant-A", settings: stored().meta.website_chat.settings, enabled: true })
    ).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("loadWebsiteChat", () => {
  it("reports not connected without a channel, and never returns tokens or secrets when connected", async () => {
    expect(await loadWebsiteChat(fakeDb(null) as never, "tenant-A")).toEqual({ connected: false, enabled: false, settings: null, snippet: null });

    const state = await loadWebsiteChat(
      fakeDb({
        id: "chan-1",
        external_account_id: "7:9",
        access_token: "ENCRYPTED",
        meta: { webhook_secret_enc: "ENC-SECRET", website_chat: { settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "a.com" }, enabled: true, websiteToken: "site-token" } },
      }) as never,
      "tenant-A"
    );
    const json = JSON.stringify(state);
    expect(json).not.toContain("ENCRYPTED");
    expect(json).not.toContain("ENC-SECRET");
    expect(state.snippet).toContain("site-token");
  });
});

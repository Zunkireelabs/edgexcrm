import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { connectWebsiteChat, updateWebsiteChat, loadWebsiteChat, uploadWebsiteChatLogo, removeWebsiteChatLogo, WebsiteChatError } from "./service";
import { decryptToken } from "../crypto";
import { DEFAULT_WEBSITE_CHAT_SETTINGS } from "./settings";

const calls: Array<{ method: string; url: string; token: string; body: unknown }> = [];
let failOn: string | null = null;

function fakeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string | FormData }) => {
    // A file upload arrives as FormData: record which parts were sent instead of parsing JSON.
    const body =
      init.body instanceof FormData
        ? { form: Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? `file:${v.type}` : v])) }
        : init.body
          ? JSON.parse(init.body)
          : undefined;
    calls.push({ method: init.method, url, token: init.headers.api_access_token, body });
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
      "POST /api/v1/profile/availability",
      "POST /api/v1/profile/auto_offline",
      "POST /api/v1/accounts/7/webhooks",
    ]);
    // Platform calls use the platform token; account calls use the new team user's token.
    expect(calls[0].token).toBe("platform-token");
    expect(calls[3].token).toBe("team-token");
    expect((calls[3].body as { channel: { type: string } }).channel.type).toBe("web_widget");
    // The inbox is named after the chat title (the form screen's header), and starts with office hours off.
    expect(calls[3].body).toMatchObject({ name: "Chat with Admizz Education", working_hours_enabled: false });
    // The shared team user is kept online (as itself, with its own token) so the chat does not say "away".
    expect(calls[5]).toMatchObject({ token: "team-token", body: { profile: { account_id: 7, availability: "online" } } });
    expect(calls[6]).toMatchObject({ token: "team-token", body: { profile: { account_id: 7, auto_offline: false } } });
    expect(calls[7].body).toEqual({ webhook: { url: "https://crm.example.com/api/webhooks/chatwoot", subscriptions: ["message_created"] } });
    // The made-up team email can never receive mail.
    expect((calls[1].body as { email: string }).email).toMatch(/@chat\.invalid$/);

    expect(db.inserted).toHaveLength(1);
    const row = db.inserted[0] as { external_account_id: string; access_token: string; status: string; meta: { webhook_secret_enc: string } };
    expect(row).toMatchObject({ tenant_id: "tenant-A", provider: "chatwoot", external_account_id: "7:9", status: "active" });
    expect(row.access_token).not.toContain("team-token");
    expect(decryptToken(row.access_token)).toBe("team-token");
    expect(decryptToken(row.meta.webhook_secret_enc)).toBe("whsec");

    expect(state).toMatchObject({ connected: true, enabled: true, logoUrl: null });
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

    expect(calls.map((c) => `${c.method} ${c.url.replace("https://inbox.example.com", "")}`)).toEqual([
      "PATCH /api/v1/accounts/7/inboxes/9",
      "POST /api/v1/profile/availability",
      "POST /api/v1/profile/auto_offline",
    ]);
    expect(calls[0]).toMatchObject({ method: "PATCH", token: "team-token" });
    // The inbox name follows the title, and the working hours go with it.
    expect(calls[0].body).toMatchObject({ name: settings.title, working_hours_enabled: false });
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

  it("still saves when keeping the team user online fails (the chat just keeps saying away)", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    failOn = "/profile/";
    const { encryptToken } = await import("../crypto");
    const db = fakeDb({ ...stored(), access_token: encryptToken("team-token") });

    const state = await updateWebsiteChat({ db: db as never, tenantId: "tenant-A", settings: stored().meta.website_chat.settings, enabled: true });

    expect(state.enabled).toBe(true);
    expect(db.updated).toHaveLength(1);
  });

  it("sends the office hours as Chatwoot's 7 day entries", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    const { encryptToken } = await import("../crypto");
    const db = fakeDb({ ...stored(), access_token: encryptToken("team-token") });
    const settings = {
      ...stored().meta.website_chat.settings,
      officeHours: { enabled: true, timezone: "Asia/Kathmandu", days: [0, 1, 2], open: "10:30", close: "18:00" },
    };

    await updateWebsiteChat({ db: db as never, tenantId: "tenant-A", settings, enabled: true });

    const body = calls[0].body as { working_hours_enabled: boolean; timezone: string; working_hours: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ working_hours_enabled: true, timezone: "Asia/Kathmandu" });
    expect(body.working_hours).toHaveLength(7);
    expect(body.working_hours[1]).toEqual({ day_of_week: 1, closed_all_day: false, open_all_day: false, open_hour: 10, open_minutes: 30, close_hour: 18, close_minutes: 0 });
    expect(body.working_hours[5]).toEqual({ day_of_week: 5, closed_all_day: true, open_all_day: false });
  });

  it("says not connected when there is no channel", async () => {
    await expect(
      updateWebsiteChat({ db: fakeDb(null) as never, tenantId: "tenant-A", settings: stored().meta.website_chat.settings, enabled: true })
    ).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("loadWebsiteChat", () => {
  it("reports not connected without a channel, and never returns tokens or secrets when connected", async () => {
    expect(await loadWebsiteChat(fakeDb(null) as never, "tenant-A")).toEqual({ connected: false, enabled: false, settings: null, snippet: null, logoUrl: null });

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

describe("website chat logo", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const row = async (logoUrl: string | null = null) => {
    const { encryptToken } = await import("../crypto");
    return {
      id: "chan-1",
      external_account_id: "7:9",
      access_token: encryptToken("team-token"),
      meta: {
        website_chat: { settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" }, enabled: true, websiteToken: "site-token", logoUrl },
      },
    };
  };

  it("uploads the file as the inbox avatar and remembers where Chatwoot put it", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "/api/v1/accounts/7/inboxes/9": { avatar_url: "https://inbox.example.com/rails/logo.png" } }));
    const db = fakeDb(await row());

    const state = await uploadWebsiteChatLogo({ db: db as never, tenantId: "tenant-A", file: { bytes: png, type: "image/png", name: "chat-logo.png" } });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PATCH", token: "team-token", body: { form: { avatar: "file:image/png" } } });
    expect(calls[0].url).toBe("https://inbox.example.com/api/v1/accounts/7/inboxes/9");
    expect(state.logoUrl).toBe("https://inbox.example.com/rails/logo.png");
    expect((db.updated[0].patch as { meta: { website_chat: { logoUrl: string } } }).meta.website_chat.logoUrl).toBe("https://inbox.example.com/rails/logo.png");
    expect(db.updated[0].filters).toEqual([["id", "chan-1"], ["tenant_id", "tenant-A"]]);
  });

  it("does not save in EdgeX when Chatwoot refuses the file, and does not leak the reason", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    failOn = "/inboxes/9";
    const db = fakeDb(await row());
    const err = await uploadWebsiteChatLogo({ db: db as never, tenantId: "tenant-A", file: { bytes: png, type: "image/png", name: "chat-logo.png" } }).catch((e) => e);
    expect(err).toBeInstanceOf(WebsiteChatError);
    expect(err.message).not.toContain("500");
    expect(db.updated).toHaveLength(0);
  });

  it("removes the logo", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    const db = fakeDb(await row("https://inbox.example.com/rails/logo.png"));

    const state = await removeWebsiteChatLogo({ db: db as never, tenantId: "tenant-A" });

    expect(calls[0]).toMatchObject({ method: "DELETE", token: "team-token" });
    expect(calls[0].url).toBe("https://inbox.example.com/api/v1/accounts/7/inboxes/9/avatar");
    expect(state.logoUrl).toBeNull();
    expect((db.updated[0].patch as { meta: { website_chat: { logoUrl: null } } }).meta.website_chat.logoUrl).toBeNull();
  });

  it("says not connected when there is no channel", async () => {
    await expect(uploadWebsiteChatLogo({ db: fakeDb(null) as never, tenantId: "tenant-A", file: { bytes: png, type: "image/png", name: "x.png" } })).rejects.toMatchObject({
      code: "not_connected",
    });
    await expect(removeWebsiteChatLogo({ db: fakeDb(null) as never, tenantId: "tenant-A" })).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("settings saved before office hours existed", () => {
  it("load fills in the default (off) office hours", async () => {
    const { officeHours: _omitted, ...oldSettings } = { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "a.com" };
    void _omitted;
    const state = await loadWebsiteChat(
      fakeDb({ id: "chan-1", external_account_id: "7:9", access_token: "x", meta: { website_chat: { settings: oldSettings, enabled: true, websiteToken: "t" } } }) as never,
      "tenant-A"
    );
    expect(state.settings?.officeHours).toMatchObject({ enabled: false });
  });
});

// The branded widget: a plain API inbox with hmac_mandatory on, no Chatwoot-side look, no website token.
describe("branded widget (api inbox)", () => {
  const apiResponses = {
    ...chatwootResponses,
    "/api/v1/accounts/7/inboxes": { id: 9, inbox_identifier: "pub-inbox-id", hmac_token: "hmac-secret" },
  };

  it("creates an API inbox with hmac_mandatory on, and stores the identifier plus the encrypted HMAC secret", async () => {
    vi.stubGlobal("fetch", fakeFetch(apiResponses));
    const db = fakeDb();
    const state = await connectWebsiteChat({ ...input(db), inboxType: "api" });

    // No availability calls: "away" is a Chatwoot-window idea. The webhook is still registered.
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://inbox.example.com", "")}`)).toEqual([
      "POST /platform/api/v1/accounts",
      "POST /platform/api/v1/users",
      "POST /platform/api/v1/accounts/7/account_users",
      "POST /api/v1/accounts/7/inboxes",
      "POST /api/v1/accounts/7/inbox_members",
      "POST /api/v1/accounts/7/webhooks",
    ]);
    expect(calls[3].body).toEqual({ name: "Chat with Admizz Education", channel: { type: "api", hmac_mandatory: true } });

    const row = db.inserted[0] as { provider: string; external_account_id: string; meta: { website_chat: Record<string, unknown> } };
    expect(row).toMatchObject({ provider: "chatwoot", external_account_id: "7:9" });
    const stored = row.meta.website_chat as { inboxType: string; inboxIdentifier: string; hmacTokenEnc: string; websiteToken?: string };
    expect(stored).toMatchObject({ inboxType: "api", inboxIdentifier: "pub-inbox-id" });
    expect(stored.websiteToken).toBeUndefined();
    expect(stored.hmacTokenEnc).not.toContain("hmac-secret");
    expect(decryptToken(stored.hmacTokenEnc)).toBe("hmac-secret");

    // No embed snippet yet, and nothing secret comes back to the browser.
    expect(state).toMatchObject({ connected: true, enabled: true, snippet: null });
    expect(JSON.stringify(state)).not.toContain("hmac-secret");
  });

  it("stores nothing when Chatwoot does not return the identifier and HMAC secret", async () => {
    vi.stubGlobal("fetch", fakeFetch({ ...chatwootResponses, "/api/v1/accounts/7/inboxes": { id: 9 } }));
    const db = fakeDb();
    await expect(connectWebsiteChat({ ...input(db), inboxType: "api" })).rejects.toMatchObject({ code: "chatwoot_failed" });
    expect(db.inserted).toHaveLength(0);
  });

  it("the default is still Chatwoot's own window (nothing changes for existing callers)", async () => {
    vi.stubGlobal("fetch", fakeFetch(chatwootResponses));
    await connectWebsiteChat(input(fakeDb()));
    expect((calls.find((c) => c.url.endsWith("/accounts/7/inboxes"))!.body as { channel: { type: string } }).channel.type).toBe("web_widget");
  });

  const apiRow = (enabled = true) => ({
    id: "chan-1",
    external_account_id: "7:9",
    access_token: "ENCRYPTED",
    meta: {
      webhook_secret_enc: "ENC-SECRET",
      website_chat: {
        settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" },
        enabled,
        inboxType: "api",
        inboxIdentifier: "pub-inbox-id",
        hmacTokenEnc: "ENC-HMAC",
      },
    },
  });

  it("saving settings or switching off touches only EdgeX, never Chatwoot", async () => {
    vi.stubGlobal("fetch", fakeFetch({}));
    const row = apiRow();
    const db = fakeDb(row);
    const settings = { ...row.meta.website_chat.settings, color: "teal" as const };
    const state = await updateWebsiteChat({ db: db as never, tenantId: "tenant-A", settings, enabled: false });

    expect(calls).toHaveLength(0);
    expect(db.updated).toHaveLength(1);
    expect(db.updated[0].filters).toEqual([["id", "chan-1"], ["tenant_id", "tenant-A"]]);
    const saved = (db.updated[0].patch as { meta: { webhook_secret_enc: string; website_chat: Record<string, unknown> } }).meta;
    expect(saved.website_chat).toMatchObject({ enabled: false, inboxType: "api", inboxIdentifier: "pub-inbox-id", hmacTokenEnc: "ENC-HMAC" });
    expect(saved.webhook_secret_enc).toBe("ENC-SECRET");
    expect(db.updated[0].patch).not.toHaveProperty("status");
    expect(state).toMatchObject({ enabled: false, snippet: null, settings: { color: "teal" } });
  });

  it("load reports connected with no snippet and never returns the HMAC secret, identifier or tokens", async () => {
    const state = await loadWebsiteChat(fakeDb(apiRow()) as never, "tenant-A");
    expect(state).toMatchObject({ connected: true, enabled: true, snippet: null });
    const json = JSON.stringify(state);
    for (const secret of ["ENCRYPTED", "ENC-SECRET", "ENC-HMAC", "hmac"]) expect(json).not.toContain(secret);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-counselor Chatwoot identity (docs/CHATWOOT-WEBSITE-CHAT-BRIEF.md): the first time a counselor
// replies on a website-chat channel, EdgeX creates their Chatwoot user, links it to the account and
// the inbox, and stores their (encrypted) credential. Later replies reuse it. Every failure path
// must surface as "use the team identity", never block a reply or expose an email address.

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./crypto", () => ({
  encryptToken: (plain: string) => `enc(${plain})`,
  decryptToken: (blob: string) => blob.replace(/^enc\((.*)\)$/, "$1"),
}));

import { buildChatwootPassword, resolveChatwootAgentToken } from "./chatwoot-agents";

const channel = {
  id: "channel-1",
  tenant_id: "tenant-1",
  provider: "chatwoot" as const,
  external_account_id: "3:7",
  display_name: "Admizz Website",
  status: "active",
  access_token: "team-admin-token",
  webhook_verify_token_hash: null,
  meta: {},
};

interface FakeDbOptions {
  existingLinkToken?: string | null;
  user?: { email?: string | null; user_metadata?: Record<string, unknown> } | null;
  insertError?: { code: string; message: string } | null;
  winnerToken?: string | null;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const inserts: Record<string, unknown>[] = [];
  let selectCalls = 0;
  const user =
    opts.user === undefined ? { email: "anil@admizz.test", user_metadata: { name: "Anil Sharma" } } : opts.user;

  const db = {
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user } }) } },
    from(table: string) {
      if (table !== "chatwoot_agent_links") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: () => {
              selectCalls += 1;
              const token = selectCalls === 1 ? opts.existingLinkToken : opts.winnerToken;
              return Promise.resolve({ data: token ? { access_token: token } : null, error: null });
            },
          };
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
      };
    },
  };
  return { db: db as never, inserts, getUserById: db.auth.admin.getUserById };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

// Chatwoot's rule (config/initializers/secure_password.rb): at least one uppercase letter, one
// lowercase letter, one number and one special character, length 6..128.
const CHATWOOT_PASSWORD_RULE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=[\]{}|']).{6,128}$/;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.CHATWOOT_BASE_URL = "https://inbox.example.test";
  process.env.CHATWOOT_PLATFORM_TOKEN = "platform-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CHATWOOT_BASE_URL;
  delete process.env.CHATWOOT_PLATFORM_TOKEN;
});

function callsTo(pathFragment: string, method: string) {
  return fetchMock.mock.calls.filter(([url, init]) => String(url).includes(pathFragment) && init.method === method);
}

describe("resolveChatwootAgentToken", () => {
  it("returns null without calling anything when the platform token is not configured", async () => {
    delete process.env.CHATWOOT_PLATFORM_TOKEN;
    const { db, getUserById } = fakeDb();
    expect(await resolveChatwootAgentToken({ db, channel, userId: "user-1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("reuses the stored credential and makes no Chatwoot calls", async () => {
    const { db } = fakeDb({ existingLinkToken: "enc(anil-token)" });
    expect(await resolveChatwootAgentToken({ db, channel, userId: "user-1" })).toBe("anil-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("first reply: creates the Chatwoot user, joins the account and inbox, stores the encrypted token", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 55, access_token: "anil-token" })) // create user
      .mockResolvedValueOnce(json([{ user_id: 1 }])) // account members
      .mockResolvedValueOnce(json({ id: 9 })) // link to account
      .mockResolvedValueOnce(json([])); // add to inbox
    const { db, inserts } = fakeDb();

    const token = await resolveChatwootAgentToken({ db, channel, userId: "user-1" });

    expect(token).toBe("anil-token");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe("https://inbox.example.test/platform/api/v1/users");
    expect(createInit.headers.api_access_token).toBe("platform-token");
    const createBody = JSON.parse(createInit.body);
    expect(createBody).toMatchObject({ name: "Anil Sharma", email: "anil@admizz.test" });
    expect(createBody.password.length).toBeGreaterThanOrEqual(24);
    expect(createBody.password).toMatch(CHATWOOT_PASSWORD_RULE);

    const [linkUrl, linkInit] = fetchMock.mock.calls[2];
    expect(linkUrl).toBe("https://inbox.example.test/platform/api/v1/accounts/3/account_users");
    expect(JSON.parse(linkInit.body)).toEqual({ user_id: 55, role: "agent" });

    const [inboxUrl, inboxInit] = fetchMock.mock.calls[3];
    expect(inboxUrl).toBe("https://inbox.example.test/api/v1/accounts/3/inbox_members");
    expect(inboxInit.headers.api_access_token).toBe("team-admin-token"); // the channel's admin credential
    expect(JSON.parse(inboxInit.body)).toEqual({ inbox_id: 7, user_ids: [55] });

    expect(inserts).toEqual([
      { tenant_id: "tenant-1", channel_id: "channel-1", user_id: "user-1", chatwoot_user_id: 55, access_token: "enc(anil-token)" },
    ]);
  });

  it("does not re-link someone already in the account (that would overwrite a higher role)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 55, access_token: "anil-token" }))
      .mockResolvedValueOnce(json([{ user_id: 55 }])) // already a member
      .mockResolvedValueOnce(json([]));
    const { db } = fakeDb();

    await resolveChatwootAgentToken({ db, channel, userId: "user-1" });

    expect(callsTo("/account_users", "POST")).toHaveLength(0);
    expect(callsTo("/inbox_members", "POST")).toHaveLength(1);
  });

  it("falls back to the team identity (null) when the profile has no name, and never sends an email to Chatwoot", async () => {
    const { db } = fakeDb({ user: { email: "anil@admizz.test", user_metadata: {} } });
    expect(await resolveChatwootAgentToken({ db, channel, userId: "user-1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back when the name is only whitespace or the user has no email", async () => {
    const blank = fakeDb({ user: { email: "anil@admizz.test", user_metadata: { name: "   " } } });
    expect(await resolveChatwootAgentToken({ db: blank.db, channel, userId: "user-1" })).toBeNull();

    const noEmail = fakeDb({ user: { email: null, user_metadata: { name: "Anil" } } });
    expect(await resolveChatwootAgentToken({ db: noEmail.db, channel, userId: "user-1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts full_name as well as name, and caps a very long name", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 56, access_token: "t" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(json([]));
    const { db } = fakeDb({ user: { email: "maya@admizz.test", user_metadata: { full_name: `  ${"M".repeat(300)}  ` } } });

    await resolveChatwootAgentToken({ db, channel, userId: "user-2" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe("M".repeat(100));
  });

  it("throws when Chatwoot refuses, so the caller can fall back to the team identity", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "nope" }, 401));
    const { db, inserts } = fakeDb();
    await expect(resolveChatwootAgentToken({ db, channel, userId: "user-1" })).rejects.toThrow("Chatwoot returned HTTP 401");
    expect(inserts).toHaveLength(0);
  });

  it("when two first replies race, uses the credential the other one stored", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 55, access_token: "my-token" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(json([]));
    const { db } = fakeDb({ insertError: { code: "23505", message: "duplicate key" }, winnerToken: "enc(winner-token)" });

    expect(await resolveChatwootAgentToken({ db, channel, userId: "user-1" })).toBe("winner-token");
  });

  it("surfaces an unexpected storage error instead of silently losing the link", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 55, access_token: "t" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(json([]));
    const { db } = fakeDb({ insertError: { code: "XX000", message: "disk full" } });
    await expect(resolveChatwootAgentToken({ db, channel, userId: "user-1" })).rejects.toThrow(/Could not store/);
  });
});

describe("buildChatwootPassword", () => {
  it("always satisfies Chatwoot's password rule, even for the worst random input", () => {
    // base64url text with no uppercase, no lowercase, no digit or no symbol used to be rejected ~37% of the time.
    // Same length as the real random part (24 bytes = 32 base64url characters).
    for (const worst of ["a".repeat(32), "A".repeat(32), "0".repeat(32), "abcdefABCDEF0123456789abcdefABCD"]) {
      expect(buildChatwootPassword(worst)).toMatch(CHATWOOT_PASSWORD_RULE);
    }
  });

  it("is random by default and within Chatwoot's length limit", () => {
    const a = buildChatwootPassword();
    const b = buildChatwootPassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(CHATWOOT_PASSWORD_RULE);
    expect(a.length).toBeLessThanOrEqual(128);
  });
});

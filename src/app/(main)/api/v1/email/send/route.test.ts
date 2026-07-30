import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { buildInboundAddress } from "@/lib/email/inbound/tokens";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const getFeatureAccessMock = vi.fn(() => true);
const checkRateLimitMock = vi.fn(async (key: string, config: unknown) => {
  void key;
  void config;
  return { allowed: true, remaining: 10, limit: 10, resetAt: 0, retryAfterSeconds: 0 };
});
const sendMessageMock = vi.fn();
const decryptAccountTokensMock = vi.fn((row: Row) => row);
const persistRefreshedTokenMock = vi.fn(async (...args: unknown[]) => {
  void args;
});
const emitEventMock = vi.fn(async (args: unknown) => {
  void args;
  return "event-1";
});

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: (key: string, config: unknown) => checkRateLimitMock(key, config),
  EMAIL_SEND_LIMIT: { maxRequests: 30, windowMs: 60_000 },
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/industries/_shared/features/email/lib/gmail-client", () => ({
  sendMessage: (account: unknown, args: unknown) => sendMessageMock(account, args),
}));
vi.mock("@/industries/_shared/features/email/lib/token-crypto", () => ({
  decryptAccountTokens: (row: Row) => decryptAccountTokensMock(row),
  persistRefreshedToken: (...args: unknown[]) => persistRefreshedTokenMock(...args),
}));
vi.mock("@/lib/api/audit", () => ({ emitEvent: (args: unknown) => emitEventMock(args) }));

const FAKE_AUTH = {
  userId: "user-1",
  email: "rep@zunkireelabs.com",
  tenantId: "tenant-a",
  role: "owner",
  industryId: "it_agency",
  permissions: {},
} as unknown as AuthContext;

const ACCOUNT_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: "tenant-a",
  user_id: "user-1",
  provider: "gmail",
  email: "rep@zunkireelabs.com",
  display_name: "Rep",
  refresh_token: "refresh",
  access_token: "access",
  token_expiry: "2099-01-01T00:00:00.000Z",
};

const EXISTING_THREAD = {
  id: "thread-existing",
  message_count: 2,
  connected_email_account_id: "11111111-1111-1111-1111-111111111111",
  lead_id: null,
  contact_id: null,
  gmail_thread_id: "gmail-thread-existing",
};

function fakeReq(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

interface FakeDbOptions {
  account?: Row | null;
  existingThread?: Row | null;
  tenantSettings?: { inbound_enabled: boolean } | null;
  forceEmailThreadsInsertError?: boolean;
  forceInboundAddressesInsertError?: boolean;
  /** raw().auth.admin.getUserById() → { data: { user: { user_metadata } } } */
  userMetadata?: Record<string, unknown> | null;
  /** raw().auth.admin.getUserById() rejects instead of resolving, when true. */
  getUserByIdThrows?: boolean;
  /** raw().from("tenants").select("name")... → { data: { name } | null } */
  tenantName?: string | null;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const state = {
    insertedThreads: [] as Row[],
    insertedAddresses: [] as Row[],
    deletedThreadIds: [] as string[],
    deletedAddressIds: [] as string[],
    updatedThreads: [] as { id: string; patch: Row }[],
    insertedEmails: [] as Row[],
    getUserByIdCallCount: 0,
  };
  let threadSeq = 0;
  let addrSeq = 0;

  const db = {
    from(table: string) {
      if (table === "connected_email_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () =>
                  opts.account
                    ? { data: opts.account, error: null }
                    : { data: null, error: { message: "not found" } },
              }),
            }),
          }),
        };
      }

      if (table === "email_threads") {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              single: async () =>
                opts.existingThread && opts.existingThread.id === id
                  ? { data: opts.existingThread, error: null }
                  : { data: null, error: { message: "not found" } },
            }),
          }),
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                if (opts.forceEmailThreadsInsertError) {
                  return { data: null, error: { message: "insert failed" } };
                }
                threadSeq += 1;
                const created = { id: `provisional-thread-${threadSeq}`, ...row };
                state.insertedThreads.push(created);
                return { data: { id: created.id }, error: null };
              },
            }),
          }),
          update: (patch: Row) => ({
            eq: async (_col: string, id: string) => {
              state.updatedThreads.push({ id, patch });
              return { data: null, error: null };
            },
          }),
          delete: () => ({
            eq: async (_col: string, id: string) => {
              state.deletedThreadIds.push(id);
              return { data: null, error: null };
            },
          }),
        };
      }

      if (table === "tenant_email_settings") {
        return {
          select: () => ({
            maybeSingle: async () => ({ data: opts.tenantSettings ?? null, error: null }),
          }),
        };
      }

      if (table === "inbound_addresses") {
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                if (opts.forceInboundAddressesInsertError) {
                  return { data: null, error: { message: "insert failed" } };
                }
                addrSeq += 1;
                const created = { id: `addr-${addrSeq}`, ...row };
                state.insertedAddresses.push(created);
                return { data: { id: created.id }, error: null };
              },
            }),
          }),
          delete: () => ({
            eq: async (_col: string, id: string) => {
              state.deletedAddressIds.push(id);
              return { data: null, error: null };
            },
          }),
        };
      }

      if (table === "emails") {
        return {
          insert: (row: Row) => ({
            select: () => ({
              single: async () => {
                const created = { id: "email-1", ...row };
                state.insertedEmails.push(created);
                return { data: { id: created.id }, error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`fakeDb: unexpected table ${table}`);
    },
    raw: () => ({
      auth: {
        admin: {
          getUserById: async (id: string) => {
            void id;
            state.getUserByIdCallCount += 1;
            if (opts.getUserByIdThrows) throw new Error("getUserById failed");
            return { data: { user: { user_metadata: opts.userMetadata ?? null } } };
          },
        },
      },
      from(table: string) {
        if (table === "tenants") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.tenantName !== undefined ? { name: opts.tenantName } : null,
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`fakeDb.raw(): unexpected table ${table}`);
      },
    }),
  };

  return { db, state };
}

beforeEach(() => {
  delete process.env.EDGEX_INBOUND_ENABLED;
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  process.env.INBOUND_EMAIL_DOMAINS = "inbound.edgex.zunkireelabs.com";
  process.env.INBOUND_ENV_MARKER = "l";

  authenticateRequestMock.mockReset().mockResolvedValue(FAKE_AUTH);
  getFeatureAccessMock.mockReset().mockReturnValue(true);
  checkRateLimitMock.mockReset().mockResolvedValue({ allowed: true, remaining: 10, limit: 10, resetAt: 0, retryAfterSeconds: 0 });
  decryptAccountTokensMock.mockReset().mockImplementation((row: Row) => row);
  persistRefreshedTokenMock.mockReset().mockResolvedValue(undefined);
  emitEventMock.mockReset().mockResolvedValue("event-1");
  sendMessageMock.mockReset().mockResolvedValue({
    gmail_message_id: "gmail-msg-1",
    gmail_thread_id: "gmail-thread-1",
    rfc_message_id: "<msg-1@edgex-crm.com>",
    refreshed_credentials: null,
  });
});

describe("POST /api/v1/email/send — flag OFF: unchanged original ordering (brief §6)", () => {
  it("sends without Reply-To and creates the email_threads row AFTER a successful send", async () => {
    const { db, state } = fakeDb({ account: ACCOUNT_ROW });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBeUndefined();

    // No provisional pre-send thread; the only thread insert happens after send.
    expect(state.insertedThreads).toHaveLength(1);
    expect(state.insertedThreads[0].gmail_thread_id).toBe("gmail-thread-1");
    expect(state.insertedAddresses).toHaveLength(0);
    expect(body.data.thread_id).toBe(state.insertedThreads[0].id);
  });
});

describe("POST /api/v1/email/send — flag ON, tenant inbound_enabled=true: pre-send wiring (brief §3/§6)", () => {
  function enableInbound() {
    process.env.EDGEX_INBOUND_ENABLED = "true";
  }

  it("fresh compose: creates a provisional thread + mints a token BEFORE sendMessage, then patches gmail_thread_id after", async () => {
    enableInbound();
    const { db, state } = fakeDb({ account: ACCOUNT_ROW, tenantSettings: { inbound_enabled: true } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);

    // Provisional thread + token existed BEFORE sendMessage was called.
    expect(state.insertedThreads).toHaveLength(1);
    expect(state.insertedThreads[0].gmail_thread_id).toBeNull();
    expect(state.insertedAddresses).toHaveLength(1);
    expect(state.insertedAddresses[0].thread_id).toBe(state.insertedThreads[0].id);
    expect(state.insertedAddresses[0].kind).toBe("thread");
    expect(state.insertedAddresses[0].verb).toBe("reply");

    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    // ACCOUNT_ROW.display_name = "Rep" (not email-shaped) → used as the Reply-To
    // label (SLICE-A-GUARD-REPLYTO-FIX-BRIEF §2); see the dedicated "Reply-To
    // display name" describe block below for the full label-resolution matrix.
    expect(sendArgs.replyTo).toMatch(/^"Rep" <reply\+l.+@inbound\.edgex\.zunkireelabs\.com>$/);

    // Post-send: the provisional thread was PATCHED (not re-inserted) with the real gmail_thread_id.
    expect(state.updatedThreads).toHaveLength(1);
    expect(state.updatedThreads[0].id).toBe(state.insertedThreads[0].id);
    expect(state.updatedThreads[0].patch.gmail_thread_id).toBe("gmail-thread-1");
    expect(body.data.thread_id).toBe(state.insertedThreads[0].id);
  });

  it("reply on an existing thread: mints a token against the EXISTING thread — no provisional thread created", async () => {
    enableInbound();
    const { db, state } = fakeDb({
      account: ACCOUNT_ROW,
      existingThread: EXISTING_THREAD,
      tenantSettings: { inbound_enabled: true },
    });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({
        from_account_id: "11111111-1111-1111-1111-111111111111",
        subject: "Re: Hi",
        body_html: "<p>Hi</p>",
        to: ["lead@example.com"],
        reply_context: { thread_id: "thread-existing" },
      }),
    );

    expect(res.status).toBe(200);
    expect(state.insertedThreads).toHaveLength(0); // reused the existing thread, never created one
    expect(state.insertedAddresses).toHaveLength(1);
    expect(state.insertedAddresses[0].thread_id).toBe("thread-existing");

    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    // ACCOUNT_ROW.display_name = "Rep" (not email-shaped) → used as the label.
    expect(sendArgs.replyTo).toMatch(/^"Rep" <reply\+l/);

    // Existing-thread bump path unchanged: message_count incremented via update.
    expect(state.updatedThreads).toHaveLength(1);
    expect(state.updatedThreads[0].id).toBe("thread-existing");
    expect(state.updatedThreads[0].patch.message_count).toBe(3);
  });

  it("tenant inbound_enabled=false: behaves exactly like flag-off even though EDGEX_INBOUND_ENABLED=true", async () => {
    enableInbound();
    const { db, state } = fakeDb({ account: ACCOUNT_ROW, tenantSettings: { inbound_enabled: false } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    await POST(fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }));

    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBeUndefined();
    expect(state.insertedAddresses).toHaveLength(0);
    // Thread still only created AFTER send, same as flag-off.
    expect(state.insertedThreads).toHaveLength(1);
    expect(state.insertedThreads[0].gmail_thread_id).toBe("gmail-thread-1");
  });

  it("mintToken misconfiguration (missing INBOUND_TOKEN_SECRET) falls back to sending without Reply-To — never blocks the send", async () => {
    enableInbound();
    delete process.env.INBOUND_TOKEN_SECRET;
    const { db, state } = fakeDb({ account: ACCOUNT_ROW, tenantSettings: { inbound_enabled: true } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );

    expect(res.status).toBe(200);
    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBeUndefined();
    // The provisional thread created before the mint failure must have been cleaned up...
    expect(state.deletedThreadIds).toHaveLength(1);
    // ...and the request falls fully back to the flag-off path: a fresh thread
    // is created AFTER the (successful) send, same as if the gate had never fired.
    expect(state.insertedThreads).toHaveLength(2);
    expect(state.insertedThreads[0].id).toBe(state.deletedThreadIds[0]);
    const finalThread = state.insertedThreads[1];
    expect(finalThread.gmail_thread_id).toBe("gmail-thread-1");
  });
});

describe("POST /api/v1/email/send — failure path: Gmail send fails after pre-send wiring (brief §6)", () => {
  it("fresh compose + gate ON: deletes the provisional thread (and its token, via cascade) and returns 503", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "true";
    const { db, state } = fakeDb({ account: ACCOUNT_ROW, tenantSettings: { inbound_enabled: true } });
    scopedClientMock.mockResolvedValue(db);
    sendMessageMock.mockReset().mockRejectedValue(new Error("Gmail API 500"));

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );

    expect(res.status).toBe(503);
    expect(state.insertedThreads).toHaveLength(1); // it WAS created pre-send...
    expect(state.deletedThreadIds).toEqual([state.insertedThreads[0].id]); // ...then rolled back
    expect(state.insertedEmails).toHaveLength(0); // never reached the post-send emails insert
  });

  it("reply + gate ON: leaves the existing thread alone, deletes only the minted token, and returns 503", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "true";
    const { db, state } = fakeDb({
      account: ACCOUNT_ROW,
      existingThread: EXISTING_THREAD,
      tenantSettings: { inbound_enabled: true },
    });
    scopedClientMock.mockResolvedValue(db);
    sendMessageMock.mockReset().mockRejectedValue(new Error("Gmail API 500"));

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({
        from_account_id: "11111111-1111-1111-1111-111111111111",
        subject: "Re: Hi",
        body_html: "<p>Hi</p>",
        to: ["lead@example.com"],
        reply_context: { thread_id: "thread-existing" },
      }),
    );

    expect(res.status).toBe(503);
    expect(state.deletedThreadIds).toHaveLength(0); // existing thread untouched
    expect(state.deletedAddressIds).toEqual([state.insertedAddresses[0].id]);
  });

  it("flag OFF + Gmail send fails: no cleanup calls at all (nothing was pre-created) — unchanged from today", async () => {
    const { db, state } = fakeDb({ account: ACCOUNT_ROW });
    scopedClientMock.mockResolvedValue(db);
    sendMessageMock.mockReset().mockRejectedValue(new Error("Gmail API 500"));

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: "11111111-1111-1111-1111-111111111111", subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );

    expect(res.status).toBe(503);
    expect(state.insertedThreads).toHaveLength(0);
    expect(state.deletedThreadIds).toHaveLength(0);
    expect(state.deletedAddressIds).toHaveLength(0);
  });
});

describe("POST /api/v1/email/send — Reply-To display name (SLICE-A-GUARD-REPLYTO-FIX-BRIEF §2)", () => {
  function enableInbound() {
    process.env.EDGEX_INBOUND_ENABLED = "true";
  }

  it("1. display_name is email-shaped (skipped) + user_metadata.name present → replyTo is a quoted label wrapping the UNTOUCHED minted token", async () => {
    enableInbound();
    const account = { ...ACCOUNT_ROW, display_name: "rep@zunkireelabs.com" };
    const { db, state } = fakeDb({
      account,
      tenantSettings: { inbound_enabled: true },
      userMetadata: { name: "Sadin Shrestha" },
    });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: account.id, subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    expect(res.status).toBe(200);

    const mintedToken = state.insertedAddresses[0].token as string;
    const expectedAddress = buildInboundAddress("reply", mintedToken);
    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBe(`"Sadin Shrestha" <${expectedAddress}>`);
    // The token embedded in replyTo is byte-identical to the minted address —
    // the label wraps it, never shortens/aliases/otherwise touches it.
    expect(sendArgs.replyTo).toContain(expectedAddress);
  });

  it("2. no name anywhere (display_name null, no user_metadata name, no tenant name) → replyTo === minted.address, unchanged/bare", async () => {
    enableInbound();
    const account = { ...ACCOUNT_ROW, display_name: null };
    const { db, state } = fakeDb({
      account,
      tenantSettings: { inbound_enabled: true },
      userMetadata: null,
      tenantName: null,
    });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: account.id, subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    expect(res.status).toBe(200);

    const mintedToken = state.insertedAddresses[0].token as string;
    const expectedAddress = buildInboundAddress("reply", mintedToken);
    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBe(expectedAddress); // bare, no quotes, no label
  });

  it("3. name lookup throws → replyTo still gets set from the mint (label is optional; a name failure must not null out replyTo or trip cleanup/rollback)", async () => {
    enableInbound();
    const account = { ...ACCOUNT_ROW, display_name: "rep@zunkireelabs.com" }; // email-shaped, skipped -> falls to the throwing lookup
    const { db, state } = fakeDb({
      account,
      tenantSettings: { inbound_enabled: true },
      getUserByIdThrows: true,
    });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: account.id, subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    expect(res.status).toBe(200);

    const mintedToken = state.insertedAddresses[0].token as string;
    const expectedAddress = buildInboundAddress("reply", mintedToken);
    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBe(expectedAddress); // bare — label lookup failed, mint didn't
    // The name-lookup failure must NOT be mistaken for an inbound-wiring failure:
    // nothing pre-created gets rolled back, and the send is not blocked.
    expect(state.deletedThreadIds).toHaveLength(0);
    expect(state.deletedAddressIds).toHaveLength(0);
    expect(state.insertedAddresses).toHaveLength(1);
  });

  it("4. EDGEX_INBOUND_ENABLED !== 'true' → replyTo undefined, no name/label lookups at all", async () => {
    // enableInbound() deliberately NOT called; beforeEach already deletes the env var.
    const account = { ...ACCOUNT_ROW, display_name: "rep@zunkireelabs.com" };
    const { db, state } = fakeDb({ account, userMetadata: { name: "Sadin Shrestha" } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({ from_account_id: account.id, subject: "Hi", body_html: "<p>Hi</p>", to: ["lead@example.com"] }),
    );
    expect(res.status).toBe(200);

    const sendArgs = sendMessageMock.mock.calls[0][1] as Row;
    expect(sendArgs.replyTo).toBeUndefined();
    expect(state.getUserByIdCallCount).toBe(0);
    expect(state.insertedAddresses).toHaveLength(0);
  });
});

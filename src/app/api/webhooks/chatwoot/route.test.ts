import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

// Phase 1 of website chat (docs/CHATWOOT-WEBSITE-CHAT-BRIEF.md): the route finds the channel
// from the payload, verifies Chatwoot's signature with THAT channel's secret, enqueues
// visitor messages, and answers unknown channels and bad signatures identically (401).

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processInboundEventsByIds: vi.fn(),
  after: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/lib/inbox/process-inbound", () => ({ processInboundEventsByIds: mocks.processInboundEventsByIds }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() } }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

const SECRET = "channel-webhook-secret";
const TEST_KEY = "a".repeat(64);

function visitorMessage(overrides: Record<string, unknown> = {}) {
  return {
    event: "message_created",
    id: 25,
    content: "Hi, I want to study in the UK",
    message_type: "incoming",
    private: false,
    created_at: "2026-11-18T12:51:33.785Z",
    account: { id: 3 },
    inbox: { id: 7 },
    sender: { id: 6, name: "Sita Rai", email: "sita@example.test", phone_number: null },
    ...overrides,
  };
}

function signedRequest(payload: unknown, opts: { secret?: string; timestamp?: string; rawBody?: string } = {}): NextRequest {
  const rawBody = opts.rawBody ?? JSON.stringify(payload);
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac("sha256", opts.secret ?? SECRET).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  return new Request("http://localhost/api/webhooks/chatwoot", {
    method: "POST",
    headers: { "content-type": "application/json", "x-chatwoot-timestamp": timestamp, "x-chatwoot-signature": signature },
    body: rawBody,
  }) as unknown as NextRequest;
}

function fakeDb(opts: { channel?: "active" | "inactive" | "none" | "no-secret"; insertFails?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const channelLookups: Array<[string, string]> = [];
  const channel = opts.channel ?? "active";

  return {
    inserts,
    channelLookups,
    db: {
      from(table: string) {
        if (table === "inbox_channels") {
          const filters: Array<[string, string]> = [];
          const chain = {
            select: () => chain,
            eq: (column: string, value: string) => {
              filters.push([column, value]);
              channelLookups.push([column, value]);
              return chain;
            },
            maybeSingle: () => {
              if (channel === "none") return Promise.resolve({ data: null, error: null });
              return Promise.resolve({
                data: {
                  id: "channel-1",
                  tenant_id: "tenant-1",
                  provider: "chatwoot",
                  status: channel === "inactive" ? "disconnected" : "active",
                  meta: channel === "no-secret" ? {} : { webhook_secret_enc: encryptForTest(SECRET) },
                },
                error: null,
              });
            },
          };
          return chain;
        }
        if (table === "events") {
          return {
            insert: (row: Record<string, unknown>) => {
              inserts.push(row);
              return {
                select: () => ({
                  single: () =>
                    opts.insertFails
                      ? Promise.resolve({ data: null, error: { message: "insert failed" } })
                      : Promise.resolve({ data: { id: `event-${inserts.length}` }, error: null }),
                }),
              };
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
  };
}

// The route decrypts with the real helper, so encrypt with it too (key set in beforeEach).
let encryptForTest: (plaintext: string) => string;

async function callRoute(request: NextRequest) {
  const { POST } = await import("./route");
  return POST(request);
}

beforeEach(async () => {
  vi.resetAllMocks();
  process.env.INBOX_CHATWOOT_ENABLED = "true";
  process.env.INBOX_TOKEN_ENC_KEY = TEST_KEY;
  encryptForTest = (await import("@/lib/inbox/crypto")).encryptToken;
});

afterEach(() => {
  delete process.env.INBOX_CHATWOOT_ENABLED;
  delete process.env.INBOX_TOKEN_ENC_KEY;
});

describe("POST /api/webhooks/chatwoot", () => {
  it("is switched off (404) unless INBOX_CHATWOOT_ENABLED is true", async () => {
    delete process.env.INBOX_CHATWOOT_ENABLED;
    const res = await callRoute(signedRequest(visitorMessage()));
    expect(res.status).toBe(404);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it("queues a correctly signed visitor message, including the visitor's email", async () => {
    const { db, inserts, channelLookups } = fakeDb();
    mocks.createServiceClient.mockResolvedValue(db);

    const res = await callRoute(signedRequest(visitorMessage()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: 1 });
    expect(channelLookups).toEqual([["provider", "chatwoot"], ["external_account_id", "3:7"]]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      tenant_id: "tenant-1",
      type: "inbox.inbound_received",
      status: "pending",
      payload: {
        channel_id: "channel-1",
        provider: "chatwoot",
        external_contact_id: "6",
        contact_email: "sita@example.test",
        contact_phone: null,
        provider_message_id: "25",
        content_text: "Hi, I want to study in the UK",
      },
    });
  });

  it("processes the queued event after the response, for exactly that event", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb().db);
    await callRoute(signedRequest(visitorMessage()));

    expect(mocks.after).toHaveBeenCalledTimes(1);
    const scheduled = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await scheduled();
    expect(mocks.processInboundEventsByIds).toHaveBeenCalledWith(["event-1"]);
  });

  it("never changes the response when the after() processing fails", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb().db);
    mocks.processInboundEventsByIds.mockRejectedValue(new Error("boom"));
    const res = await callRoute(signedRequest(visitorMessage()));
    expect(res.status).toBe(200);
    const scheduled = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await expect(scheduled()).resolves.toBeUndefined();
  });

  it("rejects a bad signature with 401 and queues nothing", async () => {
    const { db, inserts } = fakeDb();
    mocks.createServiceClient.mockResolvedValue(db);
    const res = await callRoute(signedRequest(visitorMessage(), { secret: "wrong-secret" }));
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("rejects a replayed (old) webhook with 401", async () => {
    const { db, inserts } = fakeDb();
    mocks.createServiceClient.mockResolvedValue(db);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const res = await callRoute(signedRequest(visitorMessage(), { timestamp: old }));
    expect(res.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("answers an unknown channel exactly like a bad signature, so ids cannot be probed", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb({ channel: "none" }).db);
    const unknown = await callRoute(signedRequest(visitorMessage()));

    mocks.createServiceClient.mockResolvedValue(fakeDb().db);
    const badSig = await callRoute(signedRequest(visitorMessage(), { secret: "wrong-secret" }));

    expect(unknown.status).toBe(401);
    expect(badSig.status).toBe(401);
    expect(await unknown.json()).toEqual(await badSig.json());
  });

  it("rejects disconnected channels and channels with no stored secret with 401", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb({ channel: "inactive" }).db);
    expect((await callRoute(signedRequest(visitorMessage()))).status).toBe(401);

    mocks.createServiceClient.mockResolvedValue(fakeDb({ channel: "no-secret" }).db);
    expect((await callRoute(signedRequest(visitorMessage()))).status).toBe(401);
  });

  it("rejects a payload with no account/inbox ids with 401", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb().db);
    const res = await callRoute(signedRequest({ event: "message_created", message_type: "incoming" }));
    expect(res.status).toBe(401);
  });

  it("acknowledges (200, nothing queued) signed events that are not visitor messages", async () => {
    const { db, inserts } = fakeDb();
    mocks.createServiceClient.mockResolvedValue(db);

    for (const override of [{ message_type: "template" }, { message_type: "outgoing" }, { private: true }, { event: "conversation_created" }]) {
      const res = await callRoute(signedRequest(visitorMessage(override)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, enqueued: 0 });
    }
    expect(inserts).toHaveLength(0);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("acknowledges malformed JSON with 200 instead of erroring", async () => {
    const res = await callRoute(signedRequest(null, { rawBody: "not json" }));
    expect(res.status).toBe(200);
  });

  it("does not schedule processing when the event could not be queued", async () => {
    mocks.createServiceClient.mockResolvedValue(fakeDb({ insertFails: true }).db);
    const res = await callRoute(signedRequest(visitorMessage()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, enqueued: 0 });
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// S2-B (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md): the webhook used to only enqueue an
// inbox.inbound_received event and fast-ack — nothing drained the queue until the */15
// Inngest cron ran, up to 15 minutes later. Now it schedules processInboundEventsByIds
// for exactly the event(s) THIS call enqueued via Next's after(), which must run AFTER
// the 200 response is already on the wire and must never be able to change that response
// even if it throws.

const getAdapterMock = vi.fn();
const processInboundEventsByIdsMock = vi.fn();
const afterMock = vi.fn();
const createServiceClientMock = vi.fn();
const loggerInfoMock = vi.fn();

vi.mock("@/lib/inbox/adapters", () => ({ getAdapter: getAdapterMock }));
vi.mock("@/lib/inbox/process-inbound", () => ({ processInboundEventsByIds: processInboundEventsByIdsMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: createServiceClientMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() } }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: afterMock };
});

function fakeAdapter(overrides: Partial<ReturnType<typeof baseAdapter>> = {}) {
  return { ...baseAdapter(), ...overrides };
}

function baseAdapter() {
  return {
    provider: "whatsapp" as const,
    verifySignature: () => true,
    parseStatusEvent: () => [],
    parseInboundEvent: () => [
      {
        externalContactId: "9779800000001",
        contactPhone: "+9779800000001",
        contactDisplayName: null,
        providerMessageId: "wamid.1",
        providerTimestamp: new Date().toISOString(),
        contentText: "hello",
        attachments: [] as unknown[],
        channelRef: "phone-number-id-1",
      },
    ],
  };
}

function fakeDb(opts: { channelActive?: boolean; insertFails?: boolean } = {}) {
  const inserted: { id: string }[] = [];
  const db = {
    from(table: string) {
      if (table === "inbox_channels") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      opts.channelActive === false
                        ? null
                        : { id: "channel-1", tenant_id: "tenant-1", provider: "whatsapp", external_account_id: "phone-number-id-1", status: "active" },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "events") {
        return {
          insert: () => ({
            select: () => ({
              single: () => {
                if (opts.insertFails) return Promise.resolve({ data: null, error: { message: "insert failed" } });
                const row = { id: `event-${inserted.length + 1}` };
                inserted.push(row);
                return Promise.resolve({ data: row, error: null });
              },
            }),
          }),
        };
      }
      if (table === "messages") {
        // Status-callback path, unused by these inbound-message tests.
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { db, inserted };
}

function fakeReq(): NextRequest {
  return {
    headers: { get: () => "sha256=deadbeef" },
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode("{}").buffer),
  } as unknown as NextRequest;
}

const params = Promise.resolve({ provider: "whatsapp" });

describe("POST /api/webhooks/meta/[provider] — S2-B near-instant inbound", () => {
  beforeEach(() => {
    getAdapterMock.mockReset();
    processInboundEventsByIdsMock.mockReset();
    processInboundEventsByIdsMock.mockResolvedValue({ processed: 1, skipped: 0, errors: 0 });
    afterMock.mockReset();
    createServiceClientMock.mockReset();
    loggerInfoMock.mockReset();
  });

  it("logs 'meta webhook: accepted' with the parsed message/status counts before enqueuing", async () => {
    getAdapterMock.mockReturnValue(fakeAdapter());
    const { db } = fakeDb();
    createServiceClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    await POST(fakeReq(), { params });

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "whatsapp", messageCount: 1, statusUpdateCount: 0 }),
      "meta webhook: accepted"
    );
  });

  it("acks 200 immediately and schedules after() with exactly the event id(s) it just enqueued", async () => {
    getAdapterMock.mockReturnValue(fakeAdapter());
    const { db } = fakeDb();
    createServiceClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { received: boolean; enqueued: number };

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true, enqueued: 1 });

    // after() was scheduled but its callback has NOT run yet — the response above
    // already resolved without waiting on it.
    expect(afterMock).toHaveBeenCalledTimes(1);
    expect(processInboundEventsByIdsMock).not.toHaveBeenCalled();

    const scheduled = afterMock.mock.calls[0][0] as () => Promise<void>;
    await scheduled();
    expect(processInboundEventsByIdsMock).toHaveBeenCalledWith(["event-1"]);
  });

  it("a throwing after() callback never changes the already-sent response", async () => {
    getAdapterMock.mockReturnValue(fakeAdapter());
    const { db } = fakeDb();
    createServiceClientMock.mockResolvedValue(db);
    processInboundEventsByIdsMock.mockRejectedValue(new Error("boom"));

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    expect(res.status).toBe(200);

    const scheduled = afterMock.mock.calls[0][0] as () => Promise<void>;
    // Must not throw out of the scheduled callback itself (Meta is long gone by the
    // time this runs) — the route wraps it in its own try/catch.
    await expect(scheduled()).resolves.toBeUndefined();
  });

  it("no active channel for the message → nothing enqueued, after() never scheduled", async () => {
    getAdapterMock.mockReturnValue(fakeAdapter());
    const { db } = fakeDb({ channelActive: false });
    createServiceClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { received: boolean; enqueued: number };

    expect(res.status).toBe(200);
    expect(body.enqueued).toBe(0);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("a failed event insert is not scheduled for processing", async () => {
    getAdapterMock.mockReturnValue(fakeAdapter());
    const { db } = fakeDb({ insertFails: true });
    createServiceClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq(), { params });
    const body = (await res.json()) as { received: boolean; enqueued: number };

    expect(res.status).toBe(200);
    expect(body.enqueued).toBe(0);
    expect(afterMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Focused on the session-window guard's new "a template clears the guard"
// behavior — the rest of sendMessage's pipeline (row insert, token decrypt,
// provider dispatch) is pre-existing and unchanged by this branch.

const getAdapterMock = vi.fn();
const decryptTokenMock = vi.fn((t: string) => t);

vi.mock("./adapters", () => ({ getAdapter: getAdapterMock }));
vi.mock("./crypto", () => ({ decryptToken: decryptTokenMock }));

function fakeSupabase(opts: { lastInboundTs: string | null; conversationOverrides?: Record<string, unknown> }) {
  const messageUpdates: Record<string, unknown>[] = [];
  const conversationUpdates: Record<string, unknown>[] = [];

  return {
    db: {
      from(table: string) {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: () =>
                    Promise.resolve({
                      data: {
                        id: "conv-1",
                        tenant_id: "tenant-1",
                        channel_id: "channel-1",
                        provider: "whatsapp",
                        external_contact_id: "9779818000000",
                        contact_phone: "+9779818000000",
                        contact_display_name: "Test Contact",
                        lead_id: null,
                        ai_autonomy: "off",
                        ...opts.conversationOverrides,
                      },
                      error: null,
                    }),
                }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              conversationUpdates.push(patch);
              return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
            },
          };
        }
        if (table === "inbox_channels") {
          return {
            select: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: {
                      id: "channel-1",
                      tenant_id: "tenant-1",
                      provider: "whatsapp",
                      external_account_id: "1143343632197234",
                      display_name: "Test WA",
                      status: "connected",
                      access_token: "encrypted-token",
                      webhook_verify_token_hash: null,
                      meta: {},
                    },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: () =>
                          Promise.resolve({
                            data: opts.lastInboundTs ? { provider_timestamp: opts.lastInboundTs, created_at: opts.lastInboundTs } : null,
                            error: null,
                          }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({ single: () => Promise.resolve({ data: { id: "msg-1" }, error: null }) }),
            }),
            update: (patch: Record<string, unknown>) => {
              messageUpdates.push(patch);
              return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    },
    messageUpdates,
    conversationUpdates,
  };
}

const WHATSAPP_CAPABILITIES = {
  sessionWindowHours: 24,
  requiresTemplateOutsideWindow: true,
  supportsTemplates: true,
  supportsHandover: false,
  supportsTypingIndicator: true,
};

describe("sendMessage — session-window guard", () => {
  beforeEach(() => {
    getAdapterMock.mockReset();
    decryptTokenMock.mockClear();
  });

  it("fails with OUTSIDE_SESSION_WINDOW when outside the window and no template is supplied (existing behavior, unchanged)", async () => {
    const adapterSendMock = vi.fn();
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock });
    const fake = fakeSupabase({ lastInboundTs: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "hey following up",
      author: { type: "human_agent", userId: "user-1" },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/OUTSIDE_SESSION_WINDOW/);
    expect(adapterSendMock).not.toHaveBeenCalled();
  });

  it("proceeds to send when outside the window BUT a template is supplied — the real fix", async () => {
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.tpl1", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock });
    const fake = fakeSupabase({ lastInboundTs: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "Hi Anita, your application is ready to review.",
      author: { type: "human_agent", userId: "user-1" },
      template: { name: "application_ready_v1", languageCode: "en_US" },
    });

    expect(result.status).toBe("sent");
    expect(result.providerMessageId).toBe("wamid.tpl1");
    expect(adapterSendMock).toHaveBeenCalledTimes(1);
    const [, , content] = adapterSendMock.mock.calls[0];
    expect(content.template).toEqual({ name: "application_ready_v1", languageCode: "en_US" });
  });

  it("proceeds normally when inside the window and no template is supplied (existing free-text path, unaffected)", async () => {
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.text1", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "Sure, see you then!",
      author: { type: "human_agent", userId: "user-1" },
    });

    expect(result.status).toBe("sent");
    expect(adapterSendMock).toHaveBeenCalledTimes(1);
    const [, , content] = adapterSendMock.mock.calls[0];
    expect(content.template).toBeUndefined();
  });
});

// D4 (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md / docs/INBOX-ATTACHMENTS-BRIEF.md): outbound
// is the mirror of inbound — upload bytes to the provider FIRST (it hands back a media
// id only after it has the bytes), THEN send a message referencing that id, THEN (S3:
// via after(), same pattern as the inbound webhook — never on the request's critical
// path) store our own copy so the thread renders consistently and survives the
// provider's retention.
describe("sendMessage — outbound attachments (D4 + S3 after()-deferred copy)", () => {
  const putBytesMock = vi.fn();
  const afterMock = vi.fn();
  vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));

  beforeEach(() => {
    getAdapterMock.mockReset();
    decryptTokenMock.mockClear();
    putBytesMock.mockReset();
    putBytesMock.mockResolvedValue(undefined);
    afterMock.mockReset();
  });

  const ATTACHMENT = {
    bytes: new Uint8Array([1, 2, 3, 4]),
    filename: "passport.jpg",
    mimeType: "image/jpeg",
    type: "image" as const,
    toEdgeXMs: 42,
  };

  function mockNextServerAfter() {
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>();
      return { ...actual, after: afterMock };
    });
  }

  it("uploads to the provider first, sends referencing the returned media id immediately, then stores our own copy via after() — never on the request's critical path", async () => {
    const uploadMediaMock = vi.fn().mockResolvedValue({ providerMediaId: "media-xyz" });
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.img1", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock, uploadMedia: uploadMediaMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    mockNextServerAfter();
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "my passport",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });

    expect(uploadMediaMock).toHaveBeenCalledWith(expect.anything(), ATTACHMENT.bytes, "image/jpeg", "passport.jpg");
    // Upload happens BEFORE sendMessage — the media id it returns must already be on
    // the content sendMessage is called with.
    expect(adapterSendMock).toHaveBeenCalledTimes(1);
    const [, , content] = adapterSendMock.mock.calls[0];
    expect(content.media).toEqual({ type: "image", providerMediaId: "media-xyz", filename: "passport.jpg" });

    expect(result.status).toBe("sent");

    // The response is ready without waiting on the storage copy at all.
    expect(putBytesMock).not.toHaveBeenCalled();
    const sentUpdate = fake.messageUpdates[fake.messageUpdates.length - 1];
    expect(sentUpdate).toEqual({ status: "sent", provider_message_id: "wamid.img1" });

    // Run the deferred after() callback — this is what the webhook's request lifecycle
    // would do once the response is already on the wire.
    expect(afterMock).toHaveBeenCalledTimes(1);
    const scheduled = afterMock.mock.calls[0][0] as () => Promise<void>;
    await scheduled();

    expect(putBytesMock).toHaveBeenCalledWith("inbox-media", expect.stringContaining("tenant-1/inbox/conv-1/msg-1-0"), ATTACHMENT.bytes, "image/jpeg");
    const attachmentUpdate = fake.messageUpdates[fake.messageUpdates.length - 1];
    expect(attachmentUpdate.attachments).toEqual([
      expect.objectContaining({ type: "image", provider_media_id: "media-xyz", bucket: "inbox-media", filename: "passport.jpg" }),
    ]);
  });

  it("a failure storing our own copy inside after() patches an error-marked attachment but never changes the already-sent status (non-fatal)", async () => {
    const uploadMediaMock = vi.fn().mockResolvedValue({ providerMediaId: "media-xyz" });
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.img2", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock, uploadMedia: uploadMediaMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    putBytesMock.mockRejectedValue(new Error("R2 unreachable"));
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    mockNextServerAfter();
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "my passport",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });
    expect(result.status).toBe("sent");

    const scheduled = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(scheduled()).resolves.toBeUndefined();

    const attachmentUpdate = fake.messageUpdates[fake.messageUpdates.length - 1];
    expect(attachmentUpdate.attachments).toEqual([
      expect.objectContaining({ type: "image", provider_media_id: "media-xyz", error: "R2 unreachable" }),
    ]);
    // Status was never touched by the after() patch — still "sent" from the earlier update.
    expect(fake.messageUpdates.some((u) => u.status === "failed")).toBe(false);
  });

  it("logs one timing line per outbound media send with byte size and per-stage ms, no content/PII", async () => {
    const loggerInfoMock = vi.fn();
    const uploadMediaMock = vi.fn().mockResolvedValue({ providerMediaId: "media-xyz" });
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.img3", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock, uploadMedia: uploadMediaMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("@/lib/logger", () => ({ logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() } }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    mockNextServerAfter();
    const { sendMessage } = await import("./send-message");

    await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "my passport",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });

    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        bytes: ATTACHMENT.bytes.byteLength,
        toEdgeXMs: 42,
        toMetaMs: expect.any(Number),
        toSendMs: expect.any(Number),
      }),
      "sendMessage: outbound media timing"
    );
    // No message content, filenames, or phone numbers in the logged payload.
    const [payload] = loggerInfoMock.mock.calls[0];
    expect(JSON.stringify(payload)).not.toMatch(/passport|my passport/);
  });

  it("a text-only send (no attachment) never logs the media timing line", async () => {
    const loggerInfoMock = vi.fn();
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.text2", sentAt: new Date().toISOString() });
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/logger", () => ({ logger: { info: loggerInfoMock, warn: vi.fn(), error: vi.fn() } }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "Sure, see you then!",
      author: { type: "human_agent", userId: "user-1" },
    });

    expect(loggerInfoMock).not.toHaveBeenCalled();
  });

  it("fails cleanly (never calls sendMessage) when the provider upload itself fails", async () => {
    const uploadMediaMock = vi.fn().mockRejectedValue(new Error("Meta rejected the upload"));
    const adapterSendMock = vi.fn();
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock, uploadMedia: uploadMediaMock });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/Meta rejected the upload/);
    expect(adapterSendMock).not.toHaveBeenCalled();
    expect(putBytesMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when the provider doesn't support attachments at all", async () => {
    const adapterSendMock = vi.fn();
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock }); // no uploadMedia
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/does not support attachments/);
    expect(adapterSendMock).not.toHaveBeenCalled();
  });

  it("an attachment outside the session window still requires a template — media alone does not clear the guard", async () => {
    const uploadMediaMock = vi.fn();
    const adapterSendMock = vi.fn();
    getAdapterMock.mockReturnValue({ capabilities: WHATSAPP_CAPABILITIES, sendMessage: adapterSendMock, uploadMedia: uploadMediaMock });
    const fake = fakeSupabase({ lastInboundTs: new Date(Date.now() - 48 * 3600 * 1000).toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");

    const result = await sendMessage({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      content: "",
      author: { type: "human_agent", userId: "user-1" },
      attachment: ATTACHMENT,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/OUTSIDE_SESSION_WINDOW/);
    expect(uploadMediaMock).not.toHaveBeenCalled();
    expect(adapterSendMock).not.toHaveBeenCalled();
  });
});

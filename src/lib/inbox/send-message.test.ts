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
// id only after it has the bytes), THEN send a message referencing that id, THEN store
// our own copy so the thread renders consistently and survives the provider's retention.
describe("sendMessage — outbound attachments (D4)", () => {
  const putBytesMock = vi.fn();
  vi.doMock("@/lib/storage/provider", () => ({ getStorageProvider: () => ({ putBytes: putBytesMock }) }));

  beforeEach(() => {
    getAdapterMock.mockReset();
    decryptTokenMock.mockClear();
    putBytesMock.mockReset();
    putBytesMock.mockResolvedValue(undefined);
  });

  const ATTACHMENT = {
    bytes: new Uint8Array([1, 2, 3, 4]),
    filename: "passport.jpg",
    mimeType: "image/jpeg",
    type: "image" as const,
  };

  it("uploads to the provider first, sends referencing the returned media id, then stores our own copy", async () => {
    const uploadMediaMock = vi.fn().mockResolvedValue({ providerMediaId: "media-xyz" });
    const adapterSendMock = vi.fn().mockResolvedValue({ providerMessageId: "wamid.img1", sentAt: new Date().toISOString() });
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

    expect(putBytesMock).toHaveBeenCalledWith("inbox-media", expect.stringContaining("tenant-1/inbox/conv-1/msg-1-0"), ATTACHMENT.bytes, "image/jpeg");
    expect(result.status).toBe("sent");

    const finalUpdate = fake.messageUpdates[fake.messageUpdates.length - 1];
    expect(finalUpdate.attachments).toEqual([
      expect.objectContaining({ type: "image", provider_media_id: "media-xyz", bucket: "inbox-media", filename: "passport.jpg" }),
    ]);
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

// Website chat shows the replying counselor's name: sendMessage asks the adapter (when it offers
// resolveSenderToken) for that person's own credential, only for human replies, and never lets a
// problem there block the reply — it falls back to the channel's own credential.
describe("sendMessage — replying as the counselor (adapter.resolveSenderToken)", () => {
  const NO_WINDOW = { sessionWindowHours: null, requiresTemplateOutsideWindow: false, supportsTemplates: false, supportsHandover: false, supportsTypingIndicator: false };

  async function run(adapter: Record<string, unknown>, author: { type: "human_agent"; userId: string } | { type: "ai_agent"; aiMetadata: Record<string, unknown> }) {
    getAdapterMock.mockReset();
    getAdapterMock.mockReturnValue({ capabilities: NO_WINDOW, ...adapter });
    const fake = fakeSupabase({ lastInboundTs: new Date().toISOString() });
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({ createServiceClient: () => Promise.resolve(fake.db) }));
    vi.doMock("./adapters", () => ({ getAdapter: getAdapterMock }));
    vi.doMock("./crypto", () => ({ decryptToken: decryptTokenMock }));
    const { sendMessage } = await import("./send-message");
    return sendMessage({ tenantId: "tenant-1", conversationId: "conv-1", content: "Hello", author });
  }

  it("sends with the counselor's own credential when the adapter provides one", async () => {
    const resolve = vi.fn().mockResolvedValue("anil-token");
    const send = vi.fn().mockResolvedValue({ providerMessageId: "cw-1", sentAt: new Date().toISOString() });

    const result = await run({ resolveSenderToken: resolve, sendMessage: send }, { type: "human_agent", userId: "user-1" });

    expect(result.status).toBe("sent");
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", channel: expect.objectContaining({ access_token: "encrypted-token" }) }));
    expect(send.mock.calls[0][0].access_token).toBe("anil-token");
  });

  it("keeps the channel's own credential when the adapter returns null", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "cw-2", sentAt: new Date().toISOString() });
    await run({ resolveSenderToken: vi.fn().mockResolvedValue(null), sendMessage: send }, { type: "human_agent", userId: "user-1" });
    expect(send.mock.calls[0][0].access_token).toBe("encrypted-token");
  });

  it("still sends, with the channel's credential, when resolving the person's identity throws", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "cw-3", sentAt: new Date().toISOString() });
    const result = await run(
      { resolveSenderToken: vi.fn().mockRejectedValue(new Error("Chatwoot returned HTTP 401")), sendMessage: send },
      { type: "human_agent", userId: "user-1" }
    );
    expect(result.status).toBe("sent");
    expect(send.mock.calls[0][0].access_token).toBe("encrypted-token");
  });

  it("does not ask for a person's identity on AI replies", async () => {
    const resolve = vi.fn();
    const send = vi.fn().mockResolvedValue({ providerMessageId: "cw-4", sentAt: new Date().toISOString() });
    await run({ resolveSenderToken: resolve, sendMessage: send }, { type: "ai_agent", aiMetadata: {} });
    expect(resolve).not.toHaveBeenCalled();
  });
});

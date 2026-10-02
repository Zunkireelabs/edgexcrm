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

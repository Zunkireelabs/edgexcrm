import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { whatsappAdapter } from "./whatsapp";
import type { InboxChannel, InboxConversation } from "./types";

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CHANNEL: InboxChannel = {
  id: "channel-1",
  tenant_id: "tenant-1",
  provider: "whatsapp",
  external_account_id: "1143343632197234",
  display_name: "Test WA",
  status: "connected",
  access_token: "test-token",
  webhook_verify_token_hash: null,
  meta: {},
};

const CONVERSATION: InboxConversation = {
  id: "conv-1",
  tenant_id: "tenant-1",
  channel_id: "channel-1",
  provider: "whatsapp",
  external_contact_id: "9779818000000",
  contact_phone: "+9779818000000",
  contact_display_name: "Test Contact",
  lead_id: null,
};

describe("whatsappAdapter.sendMessage — template vs free-text branching", () => {
  beforeEach(() => {
    process.env.INBOX_WHATSAPP_ENABLED = "true";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.INBOX_WHATSAPP_ENABLED;
  });

  it("sends a plain text payload when no template is provided (unchanged existing behavior)", async () => {
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.text123" }] });

    const result = await whatsappAdapter.sendMessage(CHANNEL, CONVERSATION, { text: "Hi there" });

    expect(result.providerMessageId).toBe("wamid.text123");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("text");
    expect(body.text).toEqual({ body: "Hi there" });
  });

  it("sends a template payload (type: template) when a template is provided, translating our TemplateContent shape into Meta's wire format", async () => {
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.tpl456" }] });

    const result = await whatsappAdapter.sendMessage(CHANNEL, CONVERSATION, {
      text: "Hi Anita, your application is ready to review.",
      template: {
        name: "application_ready_v1",
        languageCode: "en_US",
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "Anita" }],
          },
        ],
      },
    });

    expect(result.providerMessageId).toBe("wamid.tpl456");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v19.0/1143343632197234/messages");
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("template");
    expect(body.to).toBe("9779818000000");
    expect(body.template).toEqual({
      name: "application_ready_v1",
      language: { code: "en_US" },
      components: [{ type: "body", parameters: [{ type: "text", text: "Anita" }] }],
    });
    // The free-text `text` field must never appear alongside a template send —
    // Meta's API rejects a payload carrying both.
    expect(body.text).toBeUndefined();
  });

  it("sends a template with no components (header/body-only template needing no variables)", async () => {
    const fetchMock = mockFetchOnce({ messages: [{ id: "wamid.tpl789" }] });

    await whatsappAdapter.sendMessage(CHANNEL, CONVERSATION, {
      text: "Reminder: your class starts tomorrow.",
      template: { name: "class_reminder_v1", languageCode: "en_US" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.template).toEqual({ name: "class_reminder_v1", language: { code: "en_US" }, components: undefined });
  });

  it("still throws (not silently no-ops) when Meta rejects an unapproved/misnamed template", async () => {
    mockFetchOnce({ error: { message: "Template name does not exist in the translation" } }, 400);

    await expect(
      whatsappAdapter.sendMessage(CHANNEL, CONVERSATION, {
        text: "test",
        template: { name: "not_a_real_template", languageCode: "en_US" },
      })
    ).rejects.toThrow(/WhatsApp send failed \(400\)/);
  });
});

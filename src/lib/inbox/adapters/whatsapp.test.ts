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

// S2-A (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md / docs/INBOX-ATTACHMENTS-BRIEF.md D1):
// before this, parseInboundEvent hardcoded attachments: [] and only ever read
// msg.text?.body — a student's passport scan arrived with null text and no
// attachment, i.e. silent data loss. Parsing stays pure here: no network calls,
// just describing what the webhook payload says arrived.
describe("whatsappAdapter.parseInboundEvent — media descriptors (D1)", () => {
  beforeEach(() => {
    process.env.INBOX_WHATSAPP_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.INBOX_WHATSAPP_ENABLED;
  });

  function entryWith(message: Record<string, unknown>) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-1" },
                contacts: [{ wa_id: "9779800000001", profile: { name: "Test Student" } }],
                messages: [{ from: "9779800000001", timestamp: "1700000000", id: "wamid.media1", ...message }],
              },
            },
          ],
        },
      ],
    };
  }

  it("an image with no caption → one image attachment, contentText null (blank bubble, not lost)", () => {
    const [result] = whatsappAdapter.parseInboundEvent(
      entryWith({ type: "image", image: { id: "media-123", mime_type: "image/jpeg", sha256: "abc" } })
    );
    expect(result.attachments).toEqual([
      { type: "image", providerMediaId: "media-123", mimeType: "image/jpeg", filename: null },
    ]);
    expect(result.contentText).toBeNull();
  });

  it("an image WITH a caption → caption becomes contentText, not a blank bubble", () => {
    const [result] = whatsappAdapter.parseInboundEvent(
      entryWith({
        type: "image",
        image: { id: "media-456", mime_type: "image/jpeg", sha256: "abc", caption: "my passport" },
      })
    );
    expect(result.contentText).toBe("my passport");
    expect(result.attachments[0]).toMatchObject({ type: "image", providerMediaId: "media-456" });
  });

  it("a document carries filename AND caption", () => {
    const [result] = whatsappAdapter.parseInboundEvent(
      entryWith({
        type: "document",
        document: { id: "media-789", mime_type: "application/pdf", filename: "transcript.pdf", caption: "transcript" },
      })
    );
    expect(result.attachments).toEqual([
      { type: "document", providerMediaId: "media-789", mimeType: "application/pdf", filename: "transcript.pdf" },
    ]);
    expect(result.contentText).toBe("transcript");
  });

  it("audio/video/sticker all map through the same shape", () => {
    for (const type of ["audio", "video", "sticker"] as const) {
      const [result] = whatsappAdapter.parseInboundEvent(
        entryWith({ type, [type]: { id: `media-${type}`, mime_type: `${type}/x` } })
      );
      expect(result.attachments).toEqual([
        { type, providerMediaId: `media-${type}`, mimeType: `${type}/x`, filename: null },
      ]);
    }
  });

  it("a plain text message still has zero attachments (no regression)", () => {
    const [result] = whatsappAdapter.parseInboundEvent(entryWith({ type: "text", text: { body: "hello" } }));
    expect(result.attachments).toEqual([]);
    expect(result.contentText).toBe("hello");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  CHATWOOT_SIGNATURE_TOLERANCE_SECONDS,
  chatwootAdapter,
  chatwootChannelRef,
  chatwootChannelRefFromPayload,
  verifyChatwootSignature,
} from "./chatwoot";

const SECRET = "test-webhook-secret";

// Shape taken from a real Chatwoot 4.19.1 message_created webhook (website inbox), trimmed.
function visitorMessage(overrides: Record<string, unknown> = {}) {
  return {
    event: "message_created",
    id: 25,
    content: "Hi, I want to study in the UK",
    message_type: "incoming",
    private: false,
    created_at: "2026-11-18T12:51:33.785Z",
    account: { id: 3, name: "Admizz Education" },
    inbox: { id: 7, name: "Admizz Website" },
    conversation: { id: 2, inbox_id: 7, status: "pending" },
    sender: { id: 6, name: "Sita Rai", email: "sita@example.test", phone_number: "+9779800000001" },
    ...overrides,
  };
}

function sign(body: Buffer, timestamp: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;
}

describe("verifyChatwootSignature", () => {
  const nowMs = 1_795_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  const body = Buffer.from(JSON.stringify(visitorMessage()));

  it("accepts a correctly signed, fresh webhook", () => {
    expect(
      verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: sign(body, ts), secret: SECRET, nowMs })
    ).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: sign(body, ts, "other"), secret: SECRET, nowMs })
    ).toBe(false);
  });

  it("rejects a body that was changed after signing", () => {
    const tampered = Buffer.from(JSON.stringify(visitorMessage({ content: "changed" })));
    expect(
      verifyChatwootSignature({ rawBody: tampered, timestampHeader: ts, signatureHeader: sign(body, ts), secret: SECRET, nowMs })
    ).toBe(false);
  });

  it("rejects a stale timestamp even when the signature is valid (replay)", () => {
    const old = String(Math.floor(nowMs / 1000) - CHATWOOT_SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(
      verifyChatwootSignature({ rawBody: body, timestampHeader: old, signatureHeader: sign(body, old), secret: SECRET, nowMs })
    ).toBe(false);
  });

  it("rejects a timestamp too far in the future", () => {
    const future = String(Math.floor(nowMs / 1000) + CHATWOOT_SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(
      verifyChatwootSignature({ rawBody: body, timestampHeader: future, signatureHeader: sign(body, future), secret: SECRET, nowMs })
    ).toBe(false);
  });

  it("rejects missing or malformed headers and an empty secret", () => {
    const good = sign(body, ts);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: null, signatureHeader: good, secret: SECRET, nowMs })).toBe(false);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: null, secret: SECRET, nowMs })).toBe(false);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: "abc", signatureHeader: good, secret: SECRET, nowMs })).toBe(false);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: good.replace("sha256=", ""), secret: SECRET, nowMs })).toBe(false);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: "sha256=", secret: SECRET, nowMs })).toBe(false);
    expect(verifyChatwootSignature({ rawBody: body, timestampHeader: ts, signatureHeader: good, secret: "", nowMs })).toBe(false);
  });
});

describe("chatwootAdapter.parseInboundEvent", () => {
  it("normalizes a visitor message", () => {
    const [msg] = chatwootAdapter.parseInboundEvent(visitorMessage());
    expect(msg).toEqual({
      externalContactId: "6",
      contactPhone: "+9779800000001",
      contactDisplayName: "Sita Rai",
      contactEmail: "sita@example.test",
      providerMessageId: "25",
      providerTimestamp: "2026-11-18T12:51:33.785Z",
      contentText: "Hi, I want to study in the UK",
      attachments: [],
      channelRef: "3:7",
    });
  });

  it("maps a visitor who has not shared email or phone to nulls", () => {
    const [msg] = chatwootAdapter.parseInboundEvent(visitorMessage({ sender: { id: 6, name: "cold-glitter-91", email: null, phone_number: null } }));
    expect(msg.contactEmail).toBeNull();
    expect(msg.contactPhone).toBeNull();
    expect(msg.contactDisplayName).toBe("cold-glitter-91");
  });

  it("ignores Chatwoot's own prompts, agent replies and private notes", () => {
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ message_type: "template" }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ message_type: "outgoing" }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ private: true }))).toEqual([]);
  });

  it("ignores events other than message_created", () => {
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ event: "conversation_created" }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ event: "message_updated" }))).toEqual([]);
  });

  it("ignores payloads missing the ids needed to route and dedupe", () => {
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ id: undefined }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ account: undefined }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ inbox: undefined }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ sender: null }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(null)).toEqual([]);
  });

  it("ignores empty or whitespace-only content", () => {
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ content: "   " }))).toEqual([]);
    expect(chatwootAdapter.parseInboundEvent(visitorMessage({ content: null }))).toEqual([]);
  });
});

describe("chatwoot channel ref", () => {
  it("joins account and inbox ids", () => {
    expect(chatwootChannelRef(3, 7)).toBe("3:7");
  });

  it("is readable from any event type, not only message_created", () => {
    expect(chatwootChannelRefFromPayload({ event: "conversation_created", account: { id: 3 }, inbox: { id: 7 } })).toBe("3:7");
    expect(chatwootChannelRefFromPayload({ event: "conversation_created" })).toBeNull();
    expect(chatwootChannelRefFromPayload(null)).toBeNull();
  });
});

describe("chatwootAdapter other surface", () => {
  it("has no status events and no GET handshake", () => {
    expect(chatwootAdapter.parseStatusEvent({})).toEqual([]);
    expect(chatwootAdapter.verifyWebhook({}, null)).toBeNull();
  });

  it("does not use the env-based verifySignature (per-channel secret instead)", () => {
    expect(chatwootAdapter.verifySignature(Buffer.from("{}"), "sha256=abc")).toBe(false);
  });
});

// ── Phase 2: sending a reply ─────────────────────────────────────────────────

describe("chatwootAdapter.sendMessage", () => {
  const channel = {
    id: "channel-1",
    tenant_id: "tenant-1",
    provider: "chatwoot" as const,
    external_account_id: "3:7",
    display_name: "Admizz Website",
    status: "active",
    access_token: "chatwoot-api-token",
    webhook_verify_token_hash: null,
    meta: {},
  };
  const conversation = {
    id: "conv-1",
    tenant_id: "tenant-1",
    channel_id: "channel-1",
    provider: "chatwoot" as const,
    external_contact_id: "6",
    contact_phone: null,
    contact_display_name: "Sita",
    lead_id: null,
  };

  const fetchMock = vi.fn();

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    process.env.INBOX_CHATWOOT_ENABLED = "true";
    process.env.CHATWOOT_BASE_URL = "https://inbox.example.test/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INBOX_CHATWOOT_ENABLED;
    delete process.env.CHATWOOT_BASE_URL;
  });

  it("looks up the visitor's conversation, then posts the reply into it", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ payload: [{ id: 41, inbox_id: 7, last_activity_at: 100 }] }))
      .mockResolvedValueOnce(json({ id: 9001 }));

    const result = await chatwootAdapter.sendMessage(channel, conversation, { text: "  Thanks Sita!  " });

    expect(result.providerMessageId).toBe("9001");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [lookupUrl, lookupInit] = fetchMock.mock.calls[0];
    expect(lookupUrl).toBe("https://inbox.example.test/api/v1/accounts/3/contacts/6/conversations");
    expect(lookupInit.method).toBe("GET");
    expect(lookupInit.headers.api_access_token).toBe("chatwoot-api-token");

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe("https://inbox.example.test/api/v1/accounts/3/conversations/41/messages");
    expect(sendInit.method).toBe("POST");
    expect(JSON.parse(sendInit.body)).toEqual({ content: "Thanks Sita!", message_type: "outgoing", private: false });
  });

  it("picks the most recently active conversation in THIS inbox, ignoring other inboxes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          payload: [
            { id: 10, inbox_id: 7, last_activity_at: 100 },
            { id: 11, inbox_id: 7, last_activity_at: 300 },
            { id: 12, inbox_id: 99, last_activity_at: 999 },
          ],
        })
      )
      .mockResolvedValueOnce(json({ id: 1 }));

    await chatwootAdapter.sendMessage(channel, conversation, { text: "hi" });
    expect(fetchMock.mock.calls[1][0]).toContain("/conversations/11/messages");
  });

  it("fails clearly when the visitor has no conversation in this inbox", async () => {
    fetchMock.mockResolvedValueOnce(json({ payload: [{ id: 12, inbox_id: 99 }] }));
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow(/No Chatwoot conversation/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports only the HTTP status when Chatwoot rejects, never the token or response body", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "secret detail chatwoot-api-token" }, 401));
    const error = await chatwootAdapter.sendMessage(channel, conversation, { text: "hi" }).catch((e: Error) => e);
    expect((error as Error).message).toBe("Chatwoot returned HTTP 401");
    expect((error as Error).message).not.toContain("chatwoot-api-token");
  });

  it("turns a network failure and a timeout into clear errors", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow("Could not reach Chatwoot");

    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout);
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow("did not respond in time");
  });

  it("fails when Chatwoot accepts the message but returns no id", async () => {
    fetchMock.mockResolvedValueOnce(json({ payload: [{ id: 41, inbox_id: 7 }] })).mockResolvedValueOnce(json({}));
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow(/no message id/);
  });

  it("is off unless INBOX_CHATWOOT_ENABLED is true, and needs CHATWOOT_BASE_URL", async () => {
    delete process.env.INBOX_CHATWOOT_ENABLED;
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow(/not enabled/);

    process.env.INBOX_CHATWOOT_ENABLED = "true";
    delete process.env.CHATWOOT_BASE_URL;
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow(/CHATWOOT_BASE_URL is not set/);

    process.env.CHATWOOT_BASE_URL = "ftp://nope";
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "hi" })).rejects.toThrow(/http/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses attachments, empty text, a missing token and malformed ids without calling Chatwoot", async () => {
    await expect(
      chatwootAdapter.sendMessage(channel, conversation, { text: "x", media: { type: "image", providerMediaId: "m1" } })
    ).rejects.toThrow(/Attachments/);
    await expect(chatwootAdapter.sendMessage(channel, conversation, { text: "   " })).rejects.toThrow(/empty/);
    await expect(chatwootAdapter.sendMessage({ ...channel, access_token: null }, conversation, { text: "hi" })).rejects.toThrow(/API token/);
    await expect(chatwootAdapter.sendMessage({ ...channel, external_account_id: "3-7" }, conversation, { text: "hi" })).rejects.toThrow(/invalid Chatwoot/);
    await expect(
      chatwootAdapter.sendMessage(channel, { ...conversation, external_contact_id: "6/../../x" }, { text: "hi" })
    ).rejects.toThrow(/Invalid Chatwoot contact id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Captured from a real Chatwoot 4.19.1 API-type inbox (the branded widget's inbox), values replaced with test data.
// Proves the same adapter handles it as the web-widget inbox: nothing in the code depends on the channel type.
describe("API-type inbox webhook (branded widget)", () => {
  const apiInboxPayload = (overrides: Record<string, unknown> = {}) => ({
    event: "message_created",
    id: 321,
    content: "hello from the widget",
    message_type: "incoming",
    private: false,
    created_at: "2026-11-22T03:10:00.000Z",
    source_id: null,
    account: { id: 7, name: "Admizz Education" },
    inbox: { id: 9, name: "Chat with Admizz Education" },
    sender: { id: 55, name: "Test Visitor", email: "v@example.com", phone_number: "+9779800000000", identifier: "11111111-2222-3333-4444-555555555555" },
    conversation: { id: 3, channel: "Channel::Api", meta: { sender: { id: 55, name: "Test Visitor", phone_number: "+9779800000000" } } },
    ...overrides,
  });

  it("turns the visitor's message into an inbound record keyed to the account and inbox", () => {
    expect(chatwootAdapter.parseInboundEvent(apiInboxPayload())).toEqual([
      {
        externalContactId: "55",
        contactPhone: "+9779800000000",
        contactDisplayName: "Test Visitor",
        contactEmail: "v@example.com",
        providerMessageId: "321",
        providerTimestamp: "2026-11-22T03:10:00.000Z",
        contentText: "hello from the widget",
        attachments: [],
        channelRef: "7:9",
      },
    ]);
    expect(chatwootChannelRefFromPayload(apiInboxPayload())).toBe("7:9");
  });

  it("ignores the counsellor's own reply, which Chatwoot also reports", () => {
    expect(chatwootAdapter.parseInboundEvent(apiInboxPayload({ message_type: "outgoing", sender: { id: 2, name: "Counsellor", type: "user" } }))).toEqual([]);
  });
});

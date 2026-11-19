// Chatwoot adapter — website chat (a self-hosted Chatwoot sits behind EdgeX; see
// docs/CHATWOOT-WEBSITE-CHAT-BRIEF.md). PHASE 1 = RECEIVE: parse inbound visitor messages
// and verify Chatwoot's signed webhooks. PHASE 2 = SEND: post a counselor's reply into the
// visitor's Chatwoot conversation (text only; the channel's access_token is the Chatwoot
// API token, CHATWOOT_BASE_URL is server config).
//
// Unlike the Meta adapters, the signing secret is PER CHANNEL (each Chatwoot webhook has
// its own), so the interface's env-based verifySignature() cannot apply. The dedicated
// route (src/app/api/webhooks/chatwoot/route.ts) resolves the channel first and then
// calls verifyChatwootSignature() with that channel's secret.
//
// Chatwoot signing (verified against Chatwoot 4.19.1, lib/webhooks/trigger.rb):
//   X-Chatwoot-Timestamp: <unix seconds>
//   X-Chatwoot-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

import { createHmac, timingSafeEqual } from "crypto";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  NormalizedInbound,
  SendResult,
  StatusEventResult,
} from "./types";

/** Reject webhooks whose timestamp is further than this from "now" (replay protection). */
export const CHATWOOT_SIGNATURE_TOLERANCE_SECONDS = 300;

const CAPABILITIES: ChannelCapabilities = {
  // Web chat has no 24h session window and no templates.
  sessionWindowHours: null,
  requiresTemplateOutsideWindow: false,
  supportsTemplates: false,
  supportsHandover: false,
  supportsTypingIndicator: false,
};

export interface VerifyChatwootSignatureInput {
  rawBody: Buffer;
  timestampHeader: string | null;
  signatureHeader: string | null;
  secret: string;
  /** Injectable clock for tests; defaults to Date.now(). */
  nowMs?: number;
}

/** True only when the timestamp is fresh and the HMAC over "<ts>.<body>" matches. Never throws. */
export function verifyChatwootSignature(input: VerifyChatwootSignatureInput): boolean {
  const { rawBody, timestampHeader, signatureHeader, secret } = input;
  if (!secret || !timestampHeader || !signatureHeader) return false;

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isInteger(timestampSeconds)) return false;

  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > CHATWOOT_SIGNATURE_TOLERANCE_SECONDS) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const providedHex = signatureHeader.slice(prefix.length);

  const expectedHex = createHmac("sha256", secret)
    .update(`${timestampHeader}.`)
    .update(rawBody)
    .digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (provided.length === 0 || provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// The subset of Chatwoot's `message_created` webhook that we read.
interface ChatwootSender {
  id?: number | string;
  name?: string | null;
  email?: string | null;
  phone_number?: string | null;
}

interface ChatwootMessageCreated {
  event?: string;
  id?: number | string;
  content?: string | null;
  message_type?: string;
  private?: boolean;
  created_at?: string | null;
  account?: { id?: number | string };
  inbox?: { id?: number | string };
  sender?: ChatwootSender | null;
}

/** "<chatwoot account id>:<chatwoot inbox id>" — what inbox_channels.external_account_id holds. */
export function chatwootChannelRef(accountId: number | string, inboxId: number | string): string {
  return `${accountId}:${inboxId}`;
}

/**
 * The channel a webhook belongs to, read from ANY Chatwoot event (not only message_created),
 * so the route can find the channel and its secret before it trusts the body. Null when the
 * payload carries no account/inbox id.
 */
export function chatwootChannelRefFromPayload(payload: unknown): string | null {
  const event = payload as ChatwootMessageCreated | null;
  const accountId = event?.account?.id;
  const inboxId = event?.inbox?.id;
  if (accountId == null || inboxId == null) return null;
  return chatwootChannelRef(accountId, inboxId);
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const chatwootAdapter: ChannelAdapter = {
  provider: "chatwoot",
  capabilities: CAPABILITIES,

  // Chatwoot has no GET hub-challenge handshake.
  verifyWebhook() {
    return null;
  },

  // Per-channel secret + timestamp: use verifyChatwootSignature() from the route instead.
  verifySignature() {
    return false;
  },

  /**
   * Only a visitor's own, non-private message becomes an inbound record. Chatwoot also fires
   * message_created for its own prompts ("template"), agent replies ("outgoing") and private
   * notes; those are not visitor messages and are ignored here.
   */
  parseInboundEvent(payload): NormalizedInbound[] {
    const event = payload as ChatwootMessageCreated | null;
    if (!event || event.event !== "message_created") return [];
    if (event.message_type !== "incoming" || event.private === true) return [];

    const accountId = event.account?.id;
    const inboxId = event.inbox?.id;
    const senderId = event.sender?.id;
    if (accountId == null || inboxId == null || senderId == null || event.id == null) return [];

    const text = nonEmpty(event.content);
    if (!text) return []; // attachment-only messages are not handled in Phase 1

    return [
      {
        externalContactId: String(senderId),
        contactPhone: nonEmpty(event.sender?.phone_number),
        contactDisplayName: nonEmpty(event.sender?.name),
        contactEmail: nonEmpty(event.sender?.email),
        providerMessageId: String(event.id),
        providerTimestamp: nonEmpty(event.created_at),
        contentText: text,
        attachments: [],
        channelRef: chatwootChannelRef(accountId, inboxId),
      },
    ];
  },

  parseStatusEvent(): StatusEventResult[] {
    return [];
  },

  /**
   * Post the counselor's reply into the visitor's Chatwoot conversation, so it appears in
   * their website bubble. Throws on any failure: sendMessage() (send-message.ts) catches it
   * and marks the message "failed" with the error, instead of showing a reply that was never
   * delivered. Only plain text for now.
   */
  async sendMessage(channel, conversation, content): Promise<SendResult> {
    if (process.env.INBOX_CHATWOOT_ENABLED !== "true") {
      throw new Error("Website chat is not enabled (INBOX_CHATWOOT_ENABLED is not set)");
    }
    if (content.media) {
      throw new Error("Attachments are not supported for website chat yet");
    }
    const text = content.text?.trim();
    if (!text) throw new Error("Cannot send an empty message");
    if (!channel.access_token) throw new Error("Website chat channel has no Chatwoot API token");

    const baseUrl = chatwootBaseUrl();
    const { accountId, inboxId } = parseChatwootChannelRef(channel.external_account_id);
    const contactId = conversation.external_contact_id;
    if (!/^\d+$/.test(contactId)) throw new Error("Invalid Chatwoot contact id on this conversation");

    const accountUrl = `${baseUrl}/api/v1/accounts/${accountId}`;
    const chatwootConversationId = await findLatestChatwootConversationId(accountUrl, channel.access_token, contactId, inboxId);

    const sent = await chatwootRequest<{ id?: number | string }>(
      "POST",
      `${accountUrl}/conversations/${chatwootConversationId}/messages`,
      channel.access_token,
      { content: text, message_type: "outgoing", private: false }
    );
    if (sent.id == null) throw new Error("Chatwoot accepted the message but returned no message id");

    return { providerMessageId: String(sent.id), sentAt: new Date().toISOString() };
  },
};

// ── Sending helpers ──────────────────────────────────────────────────────────

const CHATWOOT_REQUEST_TIMEOUT_MS = 10_000;

/** Server-side config, never taken from a tenant-editable field (that would allow SSRF). */
function chatwootBaseUrl(): string {
  const raw = process.env.CHATWOOT_BASE_URL?.trim();
  if (!raw) throw new Error("CHATWOOT_BASE_URL is not set");
  if (!/^https?:\/\//.test(raw)) throw new Error("CHATWOOT_BASE_URL must start with http:// or https://");
  return raw.replace(/\/+$/, "");
}

function parseChatwootChannelRef(externalAccountId: string): { accountId: string; inboxId: string } {
  const match = /^(\d+):(\d+)$/.exec(externalAccountId);
  if (!match) throw new Error("Website chat channel has an invalid Chatwoot account/inbox reference");
  return { accountId: match[1], inboxId: match[2] };
}

async function chatwootRequest<T>(method: "GET" | "POST", url: string, apiToken: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", api_access_token: apiToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CHATWOOT_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(timedOut ? "Chatwoot did not respond in time" : "Could not reach Chatwoot");
  }
  // Only the status is reported: the response body and request headers (token) never reach logs or the UI.
  if (!response.ok) throw new Error(`Chatwoot returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface ChatwootContactConversation {
  id: number;
  inbox_id: number;
  last_activity_at?: number;
}

/** The visitor's most recently active conversation in THIS inbox (a contact can have several). */
async function findLatestChatwootConversationId(
  accountUrl: string,
  apiToken: string,
  contactId: string,
  inboxId: string
): Promise<number> {
  const result = await chatwootRequest<{ payload?: ChatwootContactConversation[] }>(
    "GET",
    `${accountUrl}/contacts/${contactId}/conversations`,
    apiToken
  );
  const inThisInbox = (result.payload ?? []).filter((c) => String(c.inbox_id) === inboxId);
  if (inThisInbox.length === 0) throw new Error("No Chatwoot conversation found for this visitor");
  inThisInbox.sort((a, b) => (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));
  return inThisInbox[0].id;
}

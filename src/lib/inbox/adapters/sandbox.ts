import { createHmac, timingSafeEqual } from "crypto";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  NormalizedInbound,
  StatusEventResult,
  SendResult,
} from "./types";

// Sandbox inbound payload shape posted by the test harness
interface SandboxMessage {
  from: string;           // external_contact_id (e.g. "user_123")
  from_phone?: string;    // optional E.164 phone
  from_name?: string;     // optional display name
  message_id: string;     // provider_message_id
  timestamp?: string;     // ISO timestamp
  text?: string;
  attachments?: unknown[];
}

interface SandboxPayload {
  messages: SandboxMessage[];
}

const CAPABILITIES: ChannelCapabilities = {
  sessionWindowHours: null,
  requiresTemplateOutsideWindow: false,
  supportsTemplates: false,
  supportsHandover: false,
  supportsTypingIndicator: false,
};

export const sandboxAdapter: ChannelAdapter = {
  provider: "sandbox",
  capabilities: CAPABILITIES,

  verifyWebhook(params, channelVerifyTokenHash) {
    const mode = params["hub.mode"];
    const token = params["hub.verify_token"];
    const challenge = params["hub.challenge"];

    if (mode !== "subscribe" || !token || !challenge) return null;

    // Verify token is stored as SHA-256 hash
    const incoming = createHmac("sha256", "").update(token).digest("hex");
    // Use constant-time compare if hash is available; else fall back to env secret
    const envSecret = process.env.INBOX_SANDBOX_SECRET;
    if (envSecret) {
      const expected = createHmac("sha256", "").update(envSecret).digest("hex");
      try {
        const a = Buffer.from(incoming, "hex");
        const b = Buffer.from(expected, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      } catch {
        return null;
      }
    } else if (channelVerifyTokenHash) {
      // channel-stored hash (sha256(raw_token))
      const tokenHash = createHmac("sha256", "").update(token).digest("hex");
      try {
        const a = Buffer.from(tokenHash, "hex");
        const b = Buffer.from(channelVerifyTokenHash, "hex");
        if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      } catch {
        return null;
      }
    }

    return challenge;
  },

  verifySignature(rawBody, sigHeader) {
    const secret = process.env.INBOX_SANDBOX_SECRET;
    if (!secret) return false;
    if (!sigHeader) return false;

    // Header format: sha256=<hex>
    const prefix = "sha256=";
    if (!sigHeader.startsWith(prefix)) return false;
    const provided = sigHeader.slice(prefix.length);

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    try {
      const a = Buffer.from(provided, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  },

  parseInboundEvent(payload) {
    const p = payload as SandboxPayload;
    if (!p?.messages || !Array.isArray(p.messages)) return [];

    return p.messages
      .filter((m) => m.from && m.message_id)
      .map((m): NormalizedInbound => ({
        externalContactId: m.from,
        contactPhone: m.from_phone ?? null,
        contactDisplayName: m.from_name ?? null,
        providerMessageId: m.message_id,
        providerTimestamp: m.timestamp ?? null,
        contentText: m.text ?? null,
        attachments: m.attachments ?? [],
        channelRef: "",  // sandbox routes by X-Channel-ID header; channelRef unused
      }));
  },

  parseStatusEvent(): StatusEventResult[] {
    return [];
  },

  async sendMessage(): Promise<SendResult> {
    // Sandbox echo: no external call needed
    return {
      providerMessageId: `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sentAt: new Date().toISOString(),
    };
  },
};

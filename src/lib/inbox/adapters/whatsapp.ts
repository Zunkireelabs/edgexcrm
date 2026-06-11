// WhatsApp Cloud API adapter — BUILT but FLAG-DISABLED.
// Activate by setting INBOX_WHATSAPP_ENABLED=true in env.
// Flipping the flag is the only change needed to go live (the seam already holds).
//
// Ships with the 24h-session-window guard so that business rule lands before
// WhatsApp is even enabled.

import { createHmac, timingSafeEqual } from "crypto";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  NormalizedInbound,
  SendResult,
} from "./types";

const CAPABILITIES: ChannelCapabilities = {
  sessionWindowHours: 24,
  requiresTemplateOutsideWindow: true,
  supportsTemplates: true,
  supportsHandover: false,
  supportsTypingIndicator: true,
};

// WhatsApp Cloud API inbound payload shapes (simplified)
interface WAContact {
  profile?: { name?: string };
  wa_id?: string;
}
interface WAMessage {
  id: string;
  from: string;
  timestamp: string;
  text?: { body?: string };
  type: string;
}
interface WAValue {
  contacts?: WAContact[];
  messages?: WAMessage[];
}
interface WAChange {
  value?: WAValue;
}
interface WAEntry {
  changes?: WAChange[];
}
interface WAPayload {
  entry?: WAEntry[];
}

const NOT_ENABLED = "WhatsApp channel is built but not yet enabled (INBOX_WHATSAPP_ENABLED is not set)";

export const whatsappAdapter: ChannelAdapter = {
  provider: "whatsapp",
  capabilities: CAPABILITIES,

  verifyWebhook(params) {
    if (!process.env.INBOX_WHATSAPP_ENABLED) throw new Error(NOT_ENABLED);
    const mode = params["hub.mode"];
    const token = params["hub.verify_token"];
    const challenge = params["hub.challenge"];
    const configToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode !== "subscribe" || !token || !challenge || !configToken) return null;
    if (token !== configToken) return null;
    return challenge;
  },

  verifySignature(rawBody, sigHeader) {
    if (!process.env.INBOX_WHATSAPP_ENABLED) return false;
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret || !sigHeader) return false;

    const prefix = "sha256=";
    if (!sigHeader.startsWith(prefix)) return false;
    const provided = sigHeader.slice(prefix.length);
    const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");

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
    if (!process.env.INBOX_WHATSAPP_ENABLED) return [];

    const p = payload as WAPayload;
    const results: NormalizedInbound[] = [];

    for (const entry of p?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value?.messages) continue;

        const contactMap: Record<string, WAContact> = {};
        for (const c of value.contacts ?? []) {
          if (c.wa_id) contactMap[c.wa_id] = c;
        }

        for (const msg of value.messages) {
          const contact = contactMap[msg.from];
          results.push({
            externalContactId: msg.from,
            contactPhone: `+${msg.from}`,
            contactDisplayName: contact?.profile?.name ?? null,
            providerMessageId: msg.id,
            providerTimestamp: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
            contentText: msg.text?.body ?? null,
            attachments: [],
          });
        }
      }
    }

    return results;
  },

  async sendMessage(channel, conversation, content): Promise<SendResult> {
    if (!process.env.INBOX_WHATSAPP_ENABLED) {
      throw new Error(NOT_ENABLED);
    }

    const token = channel.access_token;
    if (!token) throw new Error("WhatsApp channel missing access_token");

    const url = `https://graph.facebook.com/v19.0/${channel.external_account_id}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: conversation.external_contact_id,
      type: "text",
      text: { body: content.text },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      throw new Error(`WhatsApp send failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { messages?: { id?: string }[] };
    return {
      providerMessageId: data.messages?.[0]?.id ?? null,
      sentAt: new Date().toISOString(),
    };
  },
};

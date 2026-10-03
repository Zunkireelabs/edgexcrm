// WhatsApp Cloud API adapter — BUILT but FLAG-DISABLED.
// Activate by setting INBOX_WHATSAPP_ENABLED=true in env.
// Flipping the flag is the only change needed to go live (the seam already holds).
//
// Ships with the 24h-session-window guard so that business rule lands before
// WhatsApp is even enabled.

import { createHmac, timingSafeEqual } from "crypto";
import { GRAPH_API_BASE } from "../graph-api";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  InboundMediaDescriptor,
  NormalizedInbound,
  StatusEventResult,
  SendResult,
  TemplateContent,
} from "./types";

// Meta's actual template-message wire format (Cloud API `messages` endpoint,
// type: "template"). Distinct from TemplateContent (our own input shape) —
// this is what that input gets translated INTO for the provider call.
interface WATemplatePayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: {
      type: string;
      parameters: { type: string; text: string }[];
    }[];
  };
}

function buildTemplatePayload(to: string, template: TemplateContent): WATemplatePayload {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.languageCode },
      components: template.components?.map((c) => ({
        type: c.type,
        parameters: c.parameters.map((p) => ({ type: p.type, text: p.text })),
      })),
    },
  };
}

interface WAMediaSendPayload {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image" | "document" | "audio" | "video";
  image?: { id: string; caption?: string };
  document?: { id: string; caption?: string; filename?: string };
  audio?: { id: string };
  video?: { id: string; caption?: string };
}

function buildMediaPayload(to: string, media: { type: WAMediaSendPayload["type"]; providerMediaId: string; filename?: string }, caption: string): WAMediaSendPayload {
  const base = { messaging_product: "whatsapp" as const, recipient_type: "individual" as const, to, type: media.type };
  switch (media.type) {
    case "document":
      return { ...base, document: { id: media.providerMediaId, caption: caption || undefined, filename: media.filename } };
    case "audio":
      // WhatsApp audio messages carry no caption field at all.
      return { ...base, audio: { id: media.providerMediaId } };
    case "video":
      return { ...base, video: { id: media.providerMediaId, caption: caption || undefined } };
    case "image":
    default:
      return { ...base, image: { id: media.providerMediaId, caption: caption || undefined } };
  }
}

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
// Meta's media object shape is identical across image/document/audio/video/sticker —
// only `caption` and `filename` are type-specific (caption: image/document/video only;
// filename: document only). Modeling one shape and reading the fields that apply keeps
// this simple instead of four near-duplicate interfaces.
interface WAMediaObject {
  id: string;
  mime_type: string;
  sha256?: string;
  caption?: string;
  filename?: string;
}
interface WAMessage {
  id: string;
  from: string;
  timestamp: string;
  text?: { body?: string };
  image?: WAMediaObject;
  document?: WAMediaObject;
  audio?: WAMediaObject;
  video?: WAMediaObject;
  sticker?: WAMediaObject;
  type: string;
}

const MEDIA_FIELDS = ["image", "document", "audio", "video", "sticker"] as const;

function extractMedia(msg: WAMessage): { attachments: InboundMediaDescriptor[]; caption: string | null } {
  const attachments: InboundMediaDescriptor[] = [];
  let caption: string | null = null;

  for (const field of MEDIA_FIELDS) {
    const media = msg[field];
    if (!media) continue;
    attachments.push({
      type: field,
      providerMediaId: media.id,
      mimeType: media.mime_type ?? null,
      filename: media.filename ?? null,
    });
    if (media.caption) caption = media.caption;
  }

  return { attachments, caption };
}
interface WAStatus {
  id: string;
  status: string;
  timestamp: string;
}
interface WAValue {
  contacts?: WAContact[];
  messages?: WAMessage[];
  statuses?: WAStatus[];
  metadata?: { phone_number_id?: string };
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

        const channelRef = value.metadata?.phone_number_id ?? "";

        for (const msg of value.messages) {
          const contact = contactMap[msg.from];
          const { attachments, caption } = extractMedia(msg);
          results.push({
            externalContactId: msg.from,
            contactPhone: `+${msg.from}`,
            contactDisplayName: contact?.profile?.name ?? null,
            providerMessageId: msg.id,
            providerTimestamp: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
            contentText: msg.text?.body ?? caption,
            attachments,
            channelRef,
          });
        }
      }
    }

    return results;
  },

  parseStatusEvent(payload): StatusEventResult[] {
    if (!process.env.INBOX_WHATSAPP_ENABLED) return [];

    const p = payload as WAPayload;
    const results: StatusEventResult[] = [];

    for (const entry of p?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const statuses = change?.value?.statuses;
        if (!statuses) continue;
        for (const s of statuses) {
          if (s.status !== "delivered" && s.status !== "read") continue;
          results.push({
            providerMessageId: s.id,
            status: s.status as "delivered" | "read",
            timestamp: s.timestamp
              ? new Date(parseInt(s.timestamp, 10) * 1000).toISOString()
              : null,
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

    const url = `${GRAPH_API_BASE}/${channel.external_account_id}/messages`;
    // A template is required outside the 24h session window (enforced by the
    // caller, send-message.ts) and optional-but-valid inside it — either way,
    // if one was supplied, send it as a template rather than free text. Meta
    // rejects a template name/language it hasn't approved, so a bad name here
    // surfaces as a normal !res.ok failure below, same as any other send error.
    // Precedence: template > media > plain text. A media reference means the caller
    // already uploaded bytes via uploadMedia() below and holds Meta's own media id —
    // `content.text`, if present, rides along as the media's caption.
    const body = content.template
      ? buildTemplatePayload(conversation.external_contact_id, content.template)
      : content.media
        ? buildMediaPayload(conversation.external_contact_id, content.media, content.text)
        : {
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

  // Outbound mirror of the inbound media flow: Meta requires bytes to be uploaded to
  // its own /media endpoint FIRST, which hands back a media id — only then can a
  // message reference it. multipart/form-data per Meta's Cloud API media-upload spec.
  async uploadMedia(channel, bytes, mimeType, filename): Promise<{ providerMediaId: string }> {
    if (!process.env.INBOX_WHATSAPP_ENABLED) throw new Error(NOT_ENABLED);
    const token = channel.access_token;
    if (!token) throw new Error("WhatsApp channel missing access_token");

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename ?? "upload");

    const res = await fetch(`${GRAPH_API_BASE}/${channel.external_account_id}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      throw new Error(`WhatsApp media upload failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error("WhatsApp media upload response had no id");
    return { providerMediaId: data.id };
  },
};

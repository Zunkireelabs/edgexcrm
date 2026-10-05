// Channel adapter contract — every provider implements this interface.
// The send/receive code never branches on provider name; it reads capability flags instead.

export type InboxProvider = 'whatsapp' | 'messenger' | 'instagram' | 'sandbox' | 'email';

export interface ChannelCapabilities {
  /** Hours the session window stays open after last customer message (24 for WhatsApp) */
  sessionWindowHours: number | null;
  /** Whether sending outside the window requires a pre-approved template */
  requiresTemplateOutsideWindow: boolean;
  supportsTemplates: boolean;
  supportsHandover: boolean;
  supportsTypingIndicator: boolean;
}

export interface InboxChannel {
  id: string;
  tenant_id: string;
  provider: InboxProvider;
  external_account_id: string;
  display_name: string;
  status: string;
  access_token: string | null;
  webhook_verify_token_hash: string | null;
  meta: Record<string, unknown>;
}

export interface InboxConversation {
  id: string;
  tenant_id: string;
  channel_id: string;
  provider: InboxProvider;
  external_contact_id: string;
  contact_phone: string | null;
  contact_display_name: string | null;
  lead_id: string | null;
}

/**
 * What the adapter can tell us about an inbound attachment from the webhook payload
 * ALONE — no network calls. Meta sends a media ID, never bytes or a durable URL;
 * resolving/downloading/persisting those bytes happens later, during inbound
 * processing (process-inbound.ts), never in the adapter (parsing stays pure).
 */
export interface InboundMediaDescriptor {
  type: "image" | "document" | "audio" | "video" | "sticker";
  providerMediaId: string;
  mimeType: string | null;
  /** Only ever present for `document` — WhatsApp doesn't send one for other types. */
  filename: string | null;
}

export interface NormalizedInbound {
  /** Stable external identifier for the sender (WA-ID / PSID / IGSID) */
  externalContactId: string;
  /** E.164-ish phone number if available (WhatsApp always has it; others may not) */
  contactPhone: string | null;
  /** Display name from provider (may be absent) */
  contactDisplayName: string | null;
  /** External message ID for idempotency */
  providerMessageId: string;
  /** ISO timestamp from provider (may be absent) */
  providerTimestamp: string | null;
  /** Plain-text body, OR a media message's caption — a captioned photo is never a blank bubble */
  contentText: string | null;
  /** Media descriptors parsed from the payload; empty for a plain text message */
  attachments: InboundMediaDescriptor[];
  /** Provider account id the message arrived on (phone_number_id for WA, page id for Messenger).
   *  Used by the Meta webhook to map the payload to the correct inbox_channels row. */
  channelRef: string;
}

export interface StatusEventResult {
  providerMessageId: string;
  /** 'delivered' | 'read' — forward-only; never downgrade */
  status: 'delivered' | 'read';
  timestamp: string | null;
}

/** One variable substitution inside a template component (Meta's template-parameter shape). */
export interface TemplateParameter {
  type: "text";
  text: string;
}

/** One templated section (header/body/button) — mirrors Meta's `components[]` shape. */
export interface TemplateComponent {
  type: "header" | "body" | "button";
  parameters: TemplateParameter[];
}

/**
 * A pre-approved, provider-specific message template to send instead of free text.
 * `name` and `languageCode` must match an ALREADY-APPROVED template on the provider's
 * side (Meta rejects anything else) — this type carries no opinion about which
 * templates exist; that's decided once Business Verification + template approval
 * (Track A) actually produces real, named templates.
 */
export interface TemplateContent {
  name: string;
  languageCode: string;
  components?: TemplateComponent[];
}

/** An outbound attachment that has ALREADY been uploaded to the provider (see
 *  ChannelAdapter.uploadMedia) — this carries the provider's own media id, never bytes. */
export interface OutboundMediaRef {
  type: "image" | "document" | "audio" | "video";
  providerMediaId: string;
  filename?: string;
}

export interface SendMessageContent {
  text: string;
  /**
   * Pre-approved template payload. Required by WhatsApp to send outside the
   * 24h session window (requiresTemplateOutsideWindow); optional inside it.
   * Providers without supportsTemplates ignore this field entirely.
   */
  template?: TemplateContent;
  /** An already-uploaded media reference to send instead of/alongside free text.
   *  `text`, when present, is sent as the media's caption. */
  media?: OutboundMediaRef;
}

export interface SendResult {
  /** Provider-assigned message ID; null if send is a no-op (e.g. sandbox echo) */
  providerMessageId: string | null;
  /** ISO timestamp of send */
  sentAt: string;
}

export interface ChannelAdapter {
  readonly provider: InboxProvider;
  readonly capabilities: ChannelCapabilities;

  /**
   * Verify the GET hub-challenge handshake.
   * Returns the `hub.challenge` string if valid, null if invalid.
   */
  verifyWebhook(
    params: Record<string, string>,
    channelVerifyTokenHash: string | null
  ): string | null;

  /**
   * Verify HMAC signature on a raw POST body.
   * Returns true if signature is valid.
   */
  verifySignature(rawBody: Buffer, sigHeader: string | null): boolean;

  /**
   * Parse a raw provider payload into normalized inbound message records.
   * Returns an empty array for non-message events (delivery receipts, read marks).
   */
  parseInboundEvent(payload: unknown): NormalizedInbound[];

  /**
   * Parse a raw provider payload into delivery/read status update records.
   * Returns an empty array if the payload carries no status events (message events, etc.).
   * WhatsApp posts value.statuses[]; sandbox and stub adapters return [].
   */
  parseStatusEvent(payload: unknown): StatusEventResult[];

  /**
   * Send a message via the provider.
   * Must never throw — wrap provider errors as SendResult with providerMessageId=null.
   */
  sendMessage(
    channel: InboxChannel,
    conversation: InboxConversation,
    content: SendMessageContent
  ): Promise<SendResult>;

  /**
   * Upload raw bytes to the provider so they can be referenced by a later sendMessage
   * media send (Meta never accepts bytes inline — media must be uploaded first and
   * referenced by the id it hands back). Optional: only providers with
   * capabilities.supportsTemplates-adjacent media support implement this; others omit it.
   */
  uploadMedia?(
    channel: InboxChannel,
    bytes: Uint8Array,
    mimeType: string,
    filename: string | null
  ): Promise<{ providerMediaId: string }>;
}

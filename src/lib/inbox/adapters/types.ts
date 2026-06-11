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
  /** Plain-text body */
  contentText: string | null;
  /** Raw attachments (not fully parsed in v1) */
  attachments: unknown[];
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

export interface SendMessageContent {
  text: string;
  attachments?: unknown[];
  /** Pre-approved template payload (WhatsApp). If absent and window is closed, send will fail. */
  template?: unknown;
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
}

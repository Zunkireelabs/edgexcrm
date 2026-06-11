// Facebook Messenger adapter — INTERFACE STUB (v1).
// Real implementation ships when Messenger passes Meta app review.

import type {
  ChannelAdapter,
  ChannelCapabilities,
  NormalizedInbound,
  SendResult,
} from "./types";

const CAPABILITIES: ChannelCapabilities = {
  sessionWindowHours: null,
  requiresTemplateOutsideWindow: false,
  supportsTemplates: false,
  supportsHandover: true,
  supportsTypingIndicator: true,
};

const NOT_IMPLEMENTED = "Messenger adapter is not yet implemented";

export const messengerAdapter: ChannelAdapter = {
  provider: "messenger",
  capabilities: CAPABILITIES,

  verifyWebhook(): string | null {
    throw new Error(NOT_IMPLEMENTED);
  },

  verifySignature(): boolean {
    throw new Error(NOT_IMPLEMENTED);
  },

  parseInboundEvent(): NormalizedInbound[] {
    throw new Error(NOT_IMPLEMENTED);
  },

  async sendMessage(): Promise<SendResult> {
    throw new Error(NOT_IMPLEMENTED);
  },
};

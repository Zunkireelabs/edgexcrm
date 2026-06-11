// Instagram DM adapter — INTERFACE STUB (v1).
// Real implementation ships when Instagram passes Meta app review.

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
  supportsHandover: false,
  supportsTypingIndicator: false,
};

const NOT_IMPLEMENTED = "Instagram adapter is not yet implemented";

export const instagramAdapter: ChannelAdapter = {
  provider: "instagram",
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

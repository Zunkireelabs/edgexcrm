import type { ChannelAdapter, InboxProvider } from "./types";
import { sandboxAdapter } from "./sandbox";
import { whatsappAdapter } from "./whatsapp";
import { messengerAdapter } from "./messenger";
import { instagramAdapter } from "./instagram";

const registry: Record<InboxProvider, ChannelAdapter> = {
  sandbox: sandboxAdapter,
  whatsapp: whatsappAdapter,
  messenger: messengerAdapter,
  instagram: instagramAdapter,
  // 'email' is reserved in the provider enum but not routed through this adapter system
  email: sandboxAdapter, // placeholder — never called for email
};

export function getAdapter(provider: InboxProvider): ChannelAdapter {
  const adapter = registry[provider];
  if (!adapter) {
    throw new Error(`No adapter registered for provider: ${provider}`);
  }
  return adapter;
}

export type { ChannelAdapter, InboxProvider };

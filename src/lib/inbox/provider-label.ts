// Human-readable name for an inbox channel provider, shared by every Inbox surface
// (conversation list, thread header, contact panel). 'chatwoot' is the engine behind
// website chat, so counselors see "Website chat" instead of the product name.

const PROVIDER_LABELS: Record<string, string> = {
  sandbox: "Sandbox",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  email: "Email",
  chatwoot: "Website chat",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
